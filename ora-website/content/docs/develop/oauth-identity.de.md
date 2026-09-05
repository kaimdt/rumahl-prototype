---
title: OAuth 2.0 & rumahl Konto
description: Single Sign-On mit rumahl Konto: OAuth 2.0, OpenID Connect, PKCE-Flow, Scopes, Passkeys und Consent-Management.
readTime: 9 min
updated: 2026-09-05
featured: true
category: develop
---

Das **rumahl Konto** (rumahl Account) fungiert als föderierter Identitätsanbieter (Identity Provider, IdP) für alle Dienste, Apps und Integrationen im rumahl-Ökosystem. Über standardisiertes **OAuth 2.0** und **OpenID Connect (OIDC)** können Entwickler Authentifizierung und autorisierten Datenzugriff sicher implementieren.

## Single Sign-On mit rumahl Konto

Nutzer melden sich einmalig mit ihrem rumahl Konto an und können Drittanbieter-Apps Zugriff auf ausgewählte Daten (z. B. Smart-Home-Geräte, Automatisierungen oder Profilinformationen) gewähren, ohne Passwörter preiszugeben.

### Vorteile für Entwickler
- **Keine eigene Passwortverwaltung:** Vollständige Übernahme von Passkeys (FIDO2 / WebAuthn), 2FA und Wiederherstellungsprozessen.
- **Granulare Zustimmungsdialoge (Consent Screens):** Nutzer sehen exakt, welche Berechtigungen angefordert werden.
- **Zentraler Widerruf:** Nutzer können Berechtigungen in ihrem rumahl Konto jederzeit einsehen und entziehen.

## Autorisierungs-Flows

Je nach Art der Anwendung kommen unterschiedliche OAuth-2.0-Flows zum Einsatz:

### 1. Authorization Code Flow mit PKCE (Empfohlen)

Für Single Page Applications (SPAs), mobile Apps und serverbasierte Web-Apps ist der **Authorization Code Flow mit PKCE (RFC 7636)** verpflichtend.

```
Client App                  rumahl Konto (IdP)             Backend API
    |                               |                           |
    | 1. /oauth/authorize (PKCE)    |                           |
    |------------------------------>|                           |
    |                               |                           |
    | 2. Login & Consent Screen     |                           |
    |    (Passkey / 2FA)            |                           |
    |                               |                           |
    | 3. Redirect mit Auth-Code     |                           |
    |<------------------------------|                           |
    |                               |                           |
    | 4. /oauth/token (Code + Verifier)                         |
    |------------------------------>|                           |
    | 5. Access- & ID-Token         |                           |
    |<------------------------------|                           |
    |                                                           |
    | 6. API-Aufruf mit Bearer Token                            |
    |---------------------------------------------------------->|
```

#### Schritt 1: Erzeuge PKCE Code Verifier & Challenge

```typescript
import crypto from "crypto";

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
```

#### Schritt 2: Leite den Nutzer zum Login weiter

```
GET https://account.rumahl.com/oauth/authorize?
  client_id=YOUR_CLIENT_ID&
  response_type=code&
  redirect_uri=https%3A%2F%2Fmyapp.example.com%2Fcallback&
  scope=openid%20profile%20email%20rumahl.devices.read&
  state=xyz123SecureRandom&
  code_challenge=CHALLENGE_STRING&
  code_challenge_method=S256
```

#### Schritt 3: Tausche den Authorization Code gegen Tokens ein

```bash
curl -X POST https://account.rumahl.com/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "code=AUTHORIZATION_CODE" \
  -d "redirect_uri=https://myapp.example.com/callback" \
  -d "code_verifier=VERIFIER_STRING"
```

### 2. Client Credentials Flow (RFC 6749)

Für reine Backend-Dienste und Daemon-Tools ohne Nutzerinteraktion:

```bash
curl -X POST https://account.rumahl.com/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "YOUR_CLIENT_ID:YOUR_CLIENT_SECRET" \
  -d "grant_type=client_credentials" \
  -d "scope=developer.releases.publish"
```

## Endpunkte für Identity & Token

| Endpunkt | Methode | Beschreibung |
| --- | --- | --- |
| `/oauth/authorize` | `GET` | Interaktiver Anmelde- und Genehmigungsbildschirm |
| `/oauth/token` | `POST` | Token-Ausgabe (Code-Austausch, Refresh, Client Credentials) |
| `/oauth/userinfo` | `GET` | OIDC-Benutzerprofil des authentifizierten Nutzers |
| `/oauth/revoke` | `POST` | Widerruf eines Access- oder Refresh-Tokens |
| `/.well-known/openid-configuration` | `GET` | Discovery-Dokument mit allen Endpunkten und unterstützten Scopes |
| `/.well-known/jwks.json` | `GET` | Öffentliche Signaturschlüssel (RS256) zur JWT-Prüfung |

### Beispielantwort von `/oauth/userinfo`

```json
{
  "sub": "usr_99a8b7c6d5e4",
  "name": "Alex Meyer",
  "given_name": "Alex",
  "family_name": "Meyer",
  "email": "alex.meyer@example.com",
  "email_verified": true,
  "locale": "de-DE",
  "updated_at": 1757078400
}
```

## Scopes & Berechtigungsmodell

Scopes definieren genau, auf welche Ressourcen die Drittanbieter-Anwendung zugreifen darf:

| Scope | Typ | Berechtigungsumfang |
| --- | --- | --- |
| `openid` | OIDC | Gibt die eindeutige Nutzer-ID (`sub`) und ein ID-Token zurück |
| `profile` | OIDC | Lesezugriff auf Vor- und Nachname, Avatar und Spracheinstellungen |
| `email` | OIDC | Lesezugriff auf die verifizierte E-Mail-Adresse |
| `offline_access` | OAuth | Erlaubt die Ausgabe eines langlebigen Refresh-Tokens |
| `rumahl.account.read` | rumahl | Kontostatus, Organisationen und verknüpfte Dienste |
| `rumahl.devices.read` | Smart Home | Übersicht über Räume, Geräte und deren Sensorwerte |
| `rumahl.devices.control` | Smart Home | Schalten, Dimmen und Steuern von Smart-Home-Aktoren |
| `developer.apps.manage` | Developer | Apps im Entwickler-Portal anlegen, ändern und löschen |
| `developer.releases.publish` | Developer | Binaries und Releases für den Store hochladen |

> **Wichtig:** Fordere stets nur die Scopes an, die für die Kernfunktion deiner Anwendung zwingend erforderlich sind (Prinzip der minimalen Rechte).

## Passkeys, 2FA & Sitzungssicherheit

Das rumahl Konto setzt auf moderne Sicherheitsstandards:

- **Passkeys (FIDO2 / WebAuthn):** Phishing-resistente Authentifizierung über biometrische Sensoren (Touch ID, Face ID, Windows Hello) oder Hardware-Sicherheitsschlüssel (YubiKey).
- **Zwei-Faktor-Authentifizierung (TOTP):** Fallback für Authenticator-Apps (z. B. 1Password, Aegis).
- **Session-Management:** Jede Session ist an kryptografische Fingerabdrücke gebunden. Verdächtige Aktivitäten führen zur Anforderung einer erneuten Bestätigung.

## Zugriffswiderruf & Account-Sperren

### Token-Widerruf (Revocation)

Wenn sich ein Nutzer aus deiner Anwendung abmeldet, sollte das Refresh-Token aktiv widerrufen werden:

```bash
curl -X POST https://account.rumahl.com/oauth/revoke \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "token=REFRESH_TOKEN_OR_ACCESS_TOKEN" \
  -d "token_type_hint=refresh_token"
```

### Gesperrte Konten & Fehlercode 423

Wurde ein Nutzerkonto oder ein Entwickler-Account aufgrund von Sicherheitsvorfällen gesperrt, antwortet die API mit **HTTP 423 Locked**:

```json
{
  "error": "account_locked",
  "error_description": "This rumahl Account is temporarily locked due to security restrictions.",
  "support_url": "https://account.rumahl.com/support/unlock"
}
```
