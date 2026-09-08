---
title: SDKs & CI/CD-Integration
description: Automatisierung und Code-Beispiele mit dem TypeScript- & Python-SDK, cURL sowie GitHub Actions für Releases.
readTime: 8 min
updated: 2026-09-05
featured: true
category: develop
---

Um Entwicklern die Arbeit mit dem rumahl-Ökosystem so einfach wie möglich zu machen, stehen offizielle SDKs für TypeScript/JavaScript und Python zur Verfügung. Dieses Dokument enthält praktische Codebeispiele, Automatisierungsrezepte für GitHub Actions und Anleitungen zur Webhook-Verarbeitung.

## Offizielle Entwickler-SDKs

| Sprache / Runtime | Paket | Installation |
| --- | --- | --- |
| TypeScript / Node.js | `@rumahl/sdk` & `@rumahl/auth` | `npm install @rumahl/sdk` |
| Python 3.10+ | `rumahl-sdk` | `pip install rumahl-sdk` |
| Go | `github.com/rumahl/sdk-go` | `go get github.com/rumahl/sdk-go` |

## Authentifizierung in Skripten & Tools

### TypeScript-Beispiel: App-Details & Releases abrufen

```typescript
import { RumahlDeveloperClient } from "@rumahl/sdk";

const client = new RumahlDeveloperClient({
  apiKey: process.env.RUMAHL_API_KEY!,
  endpoint: "https://api.rumahl.com/api/v1/developer",
});

async function main() {
  // Liste aller registrierten Produkte abrufen
  const products = await client.products.list();
  console.log("Registrierte Apps:", products.map((p) => p.name));

  // Aktive Releases für eine App prüfen
  const releases = await client.releases.list("prod_8829a");
  console.log("Aktuelle Versionen:", releases);
}

main().catch(console.error);
```

### Python-Beispiel: Neues Release hochladen

```python
import os
from rumahl import DeveloperClient

client = DeveloperClient(
    api_key=os.environ["RUMAHL_API_KEY"],
    base_url="https://api.rumahl.com/api/v1/developer"
)

# 1. Release-Entwurf erstellen
release = client.releases.create(
    product_id="prod_8829a",
    version="1.3.0",
    channel="beta",
    changelog="Verbesserte Energieverwaltung und Bugfixes."
)

# 2. Bundle hochladen
with open("dist/app-1.3.0.tar.gz", "rb") as bundle_file:
    client.releases.upload_bundle(
        product_id="prod_8829a",
        version="1.3.0",
        file=bundle_file
    )

# 3. Phased Rollout auf 20% starten
client.releases.set_rollout(
    product_id="prod_8829a",
    version="1.3.0",
    percentage=20
)
print("Rollout erfolgreich gestartet!")
```

## Release-Upload per cURL

Releases lassen sich auch ohne SDK direkt über cURL in Bash-Skripten deployen:

```bash
#!/usr/bin/env bash
set -e

PRODUCT_ID="prod_8829a"
VERSION="2.1.0"
BUNDLE_PATH="./dist/app-${VERSION}.tar.gz"
API_KEY="${RUMAHL_API_KEY}"

# 1. Prüfsumme berechnen
SHA256=$(sha256sum "${BUNDLE_PATH}" | awk '{print $1}')

# 2. Release-Draft anlegen
curl -s -X POST "https://api.rumahl.com/api/v1/developer/products/${PRODUCT_ID}/releases" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"version\":\"${VERSION}\",\"channel\":\"production\",\"changelog\":\"Stabiles Release\"}"

# 3. Paket hochladen
curl -s -X POST "https://api.rumahl.com/api/v1/developer/products/${PRODUCT_ID}/releases/${VERSION}/upload" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-File-SHA256: ${SHA256}" \
  -F "bundle=@${BUNDLE_PATH}"

# 4. Rollout auf 10% aktivieren
curl -s -X POST "https://api.rumahl.com/api/v1/developer/products/${PRODUCT_ID}/releases/${VERSION}/rollout" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"target_percentage\": 10}"

echo "Release ${VERSION} erfolgreich publiziert!"
```

## CI/CD-Automatisierung mit GitHub Actions

Das folgende GitHub Actions Workflow-Template baut ein Release automatisch bei jedem neuen Git-Tag und lädt es im rumahl Developers Portal hoch:

```yaml
name: Release to rumahl Store

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install & Build Bundle
        run: |
          npm ci
          npm run build
          tar -czf dist/app-bundle.tar.gz -C dist/ .

      - name: Publish to rumahl Developers
        env:
          RUMAHL_API_KEY: ${{ secrets.RUMAHL_DEVELOPER_API_KEY }}
          PRODUCT_ID: ${{ vars.RUMAHL_PRODUCT_ID }}
        run: |
          VERSION=${GITHUB_REF#refs/tags/v}
          SHA256=$(sha256sum dist/app-bundle.tar.gz | awk '{print $1}')

          # Release-Draft anlegen
          curl -f -X POST "https://api.rumahl.com/api/v1/developer/products/$PRODUCT_ID/releases" \
            -H "X-API-Key: $RUMAHL_API_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"version\":\"$VERSION\",\"channel\":\"production\",\"changelog\":\"Automatisches GitHub-Release $VERSION\"}"

          # Bundle hochladen
          curl -f -X POST "https://api.rumahl.com/api/v1/developer/products/$PRODUCT_ID/releases/$VERSION/upload" \
            -H "X-API-Key: $RUMAHL_API_KEY" \
            -H "X-File-SHA256: $SHA256" \
            -F "bundle=@dist/app-bundle.tar.gz"

          # Phased Rollout starten
          curl -f -X POST "https://api.rumahl.com/api/v1/developer/products/$PRODUCT_ID/releases/$VERSION/rollout" \
            -H "X-API-Key: $RUMAHL_API_KEY" \
            -H "Content-Type: application/json" \
            -d '{"target_percentage": 20}'
```

## Webhook-Verarbeitung im Backend

Wenn ein Release verarbeitet wurde oder ein Nutzer seine Zustimmung widerruft, sendet rumahl einen Webhook.

### Node.js / Express Beispiel mit Signaturprüfung

```typescript
import express from "express";
import crypto from "crypto";

const app = express();
const WEBHOOK_SECRET = process.env.RUMAHL_WEBHOOK_SECRET!;

app.post(
  "/api/webhooks/rumahl",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const signatureHeader = req.headers["x-rumahl-signature"] as string;
    if (!signatureHeader) {
      return res.status(401).send("Signatur fehlt");
    }

    // Header parsen: t=timestamp,v1=signature
    const parts = Object.fromEntries(
      signatureHeader.split(",").map((p) => p.split("="))
    );

    const payload = `${parts.t}.${req.body.toString("utf8")}`;
    const expectedSignature = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");

    if (parts.v1 !== expectedSignature) {
      return res.status(403).send("Ungültige Signatur");
    }

    const event = JSON.parse(req.body.toString("utf8"));
    console.log("Verifiziertes Ereignis erhalten:", event.type);

    if (event.type === "release.published") {
      console.log(`Release ${event.data.version} ist jetzt live!`);
    }

    res.status(200).json({ received: true });
  }
);

app.listen(4000, () => console.log("Webhook-Server läuft auf Port 4000"));
```
