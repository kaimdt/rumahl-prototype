#include <iora/client.hpp>
#include <iostream>

int main() {
    try {
        // Initialize client
        iora::Client client("http://localhost:8080", "api-key");

        // Simulate temperature conversion
        double celsius = 25.0;
        double fahrenheit = (celsius * 9.0 / 5.0) + 32.0;

        std::cout << celsius << "°C = " << fahrenheit << "°F\n";

        // Send notification
        iora::NotificationPayload notification{
            .title = "Temperature Converted",
            .message = std::to_string(celsius) + "°C = " + std::to_string(fahrenheit) + "°F",
            .priority = "low"
        };
        client.send_notification(notification);

        // Store result
        client.set_storage("last_conversion", {
            {"celsius", celsius},
            {"fahrenheit", fahrenheit}
        });

        std::cout << "Conversion complete!\n";

    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << "\n";
        return 1;
    }

    return 0;
}
