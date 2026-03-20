#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{header, Method, Request, StatusCode},
        routing::get,
        Router,
    };
    use tower::ServiceExt;
    use tower_http::cors::CorsLayer;
    use std::env;

    fn create_test_app() -> Router {
        // Mock environment variable for testing
        env::set_var("CORS_ORIGINS", "http://allowed-origin.com,http://another-allowed.com");

        let cors_origins = env::var("CORS_ORIGINS").unwrap();
        let allowed_origins: Vec<header::HeaderValue> = cors_origins
            .split(',')
            .map(|s| s.trim().parse().expect("Invalid CORS origin"))
            .collect();

        let cors = CorsLayer::new()
            .allow_origin(allowed_origins)
            .allow_methods([Method::GET, Method::POST])
            .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]);

        Router::new()
            .route("/", get(|| async { "OK" }))
            .layer(cors)
    }

    #[tokio::test]
    async fn test_cors_allowed_origin() {
        let app = create_test_app();

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/")
                    .header(header::ORIGIN, "http://allowed-origin.com")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN).unwrap(),
            "http://allowed-origin.com"
        );
    }

    #[tokio::test]
    async fn test_cors_disallowed_origin() {
        let app = create_test_app();

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/")
                    .header(header::ORIGIN, "http://disallowed-origin.com")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none());
    }

    #[tokio::test]
    async fn test_cors_allowed_method() {
        let app = create_test_app();

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/")
                    .header(header::ORIGIN, "http://allowed-origin.com")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::ACCESS_CONTROL_ALLOW_METHODS).unwrap(),
            "GET, POST"
        );
    }

    #[tokio::test]
    async fn test_cors_disallowed_method() {
        let app = create_test_app();

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/")
                    .header(header::ORIGIN, "http://allowed-origin.com")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "PUT")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        // If the method is not allowed, the CORS middleware doesn't add the allow-origin header to the preflight response
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    }

    #[tokio::test]
    async fn test_cors_allowed_header() {
        let app = create_test_app();

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/")
                    .header(header::ORIGIN, "http://allowed-origin.com")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
                    .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "authorization")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::ACCESS_CONTROL_ALLOW_HEADERS).unwrap(),
            "authorization"
        );
    }
}
