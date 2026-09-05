---
title: SDKs & CI/CD Integration
description: Automation and code examples using TypeScript & Python SDKs, cURL, and GitHub Actions for releases.
readTime: 8 min
updated: 2026-09-05
featured: true
category: develop
---

To streamline building on the rumahl ecosystem, official SDKs are provided for TypeScript/JavaScript and Python. This guide covers integration examples, automated GitHub Actions deployment pipelines, and webhook verification.

## Official Developer SDKs

| Language / Runtime | Package | Installation |
| --- | --- | --- |
| TypeScript / Node.js | `@rumahl/sdk` & `@rumahl/auth` | `npm install @rumahl/sdk` |
| Python 3.10+ | `rumahl-sdk` | `pip install rumahl-sdk` |
| Go | `github.com/rumahl/sdk-go` | `go get github.com/rumahl/sdk-go` |

## Authenticating in Scripts & Tools

### TypeScript Example: Querying Apps & Releases

```typescript
import { RumahlDeveloperClient } from "@rumahl/sdk";

const client = new RumahlDeveloperClient({
  apiKey: process.env.RUMAHL_API_KEY!,
  endpoint: "https://api.rumahl.com/api/v1/developer",
});

async function main() {
  // Query all registered products
  const products = await client.products.list();
  console.log("Registered apps:", products.map((p) => p.name));

  // Inspect existing releases
  const releases = await client.releases.list("prod_8829a");
  console.log("Active versions:", releases);
}

main().catch(console.error);
```

### Python Example: Publishing a New Release

```python
import os
from rumahl import DeveloperClient

client = DeveloperClient(
    api_key=os.environ["RUMAHL_API_KEY"],
    base_url="https://api.rumahl.com/api/v1/developer"
)

# 1. Create release draft
release = client.releases.create(
    product_id="prod_8829a",
    version="1.3.0",
    channel="beta",
    changelog="Improved power efficiency and fixed edge bugs."
)

# 2. Upload binary bundle
with open("dist/app-1.3.0.tar.gz", "rb") as bundle_file:
    client.releases.upload_bundle(
        product_id="prod_8829a",
        version="1.3.0",
        file=bundle_file
    )

# 3. Trigger 20% phased rollout
client.releases.set_rollout(
    product_id="prod_8829a",
    version="1.3.0",
    percentage=20
)
print("Rollout triggered successfully!")
```

## Release Upload via cURL

Deploy releases directly from shell scripts without SDK dependencies:

```bash
#!/usr/bin/env bash
set -e

PRODUCT_ID="prod_8829a"
VERSION="2.1.0"
BUNDLE_PATH="./dist/app-${VERSION}.tar.gz"
API_KEY="${RUMAHL_API_KEY}"

# 1. Compute SHA-256 hash
SHA256=$(sha256sum "${BUNDLE_PATH}" | awk '{print $1}')

# 2. Initialize release draft
curl -s -X POST "https://api.rumahl.com/api/v1/developer/products/${PRODUCT_ID}/releases" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"version\":\"${VERSION}\",\"channel\":\"production\",\"changelog\":\"Stable release\"}"

# 3. Upload package
curl -s -X POST "https://api.rumahl.com/api/v1/developer/products/${PRODUCT_ID}/releases/${VERSION}/upload" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-File-SHA256: ${SHA256}" \
  -F "bundle=@${BUNDLE_PATH}"

# 4. Activate 10% canary rollout
curl -s -X POST "https://api.rumahl.com/api/v1/developer/products/${PRODUCT_ID}/releases/${VERSION}/rollout" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"target_percentage\": 10}"

echo "Release ${VERSION} published successfully!"
```

## CI/CD Automation with GitHub Actions

The following GitHub Actions workflow compiles the release bundle on every version tag and publishes it to the rumahl Developers Portal:

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

          # Create release draft
          curl -f -X POST "https://api.rumahl.com/api/v1/developer/products/$PRODUCT_ID/releases" \
            -H "X-API-Key: $RUMAHL_API_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"version\":\"$VERSION\",\"channel\":\"production\",\"changelog\":\"Automated GitHub release $VERSION\"}"

          # Upload release bundle
          curl -f -X POST "https://api.rumahl.com/api/v1/developer/products/$PRODUCT_ID/releases/$VERSION/upload" \
            -H "X-API-Key: $RUMAHL_API_KEY" \
            -H "X-File-SHA256: $SHA256" \
            -F "bundle=@dist/app-bundle.tar.gz"

          # Start phased rollout
          curl -f -X POST "https://api.rumahl.com/api/v1/developer/products/$PRODUCT_ID/releases/$VERSION/rollout" \
            -H "X-API-Key: $RUMAHL_API_KEY" \
            -H "Content-Type: application/json" \
            -d '{"target_percentage": 20}'
```

## Handling Webhooks in Backend

When releases complete processing or users adjust authorization grants, rumahl dispatches webhooks to your registered endpoints.

### Node.js / Express Example with Signature Verification

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
      return res.status(401).send("Missing signature header");
    }

    // Parse header: t=timestamp,v1=signature
    const parts = Object.fromEntries(
      signatureHeader.split(",").map((p) => p.split("="))
    );

    const payload = `${parts.t}.${req.body.toString("utf8")}`;
    const expectedSignature = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");

    if (parts.v1 !== expectedSignature) {
      return res.status(403).send("Invalid signature");
    }

    const event = JSON.parse(req.body.toString("utf8"));
    console.log("Verified event received:", event.type);

    if (event.type === "release.published") {
      console.log(`Release ${event.data.version} is now live!`);
    }

    res.status(200).json({ received: true });
  }
);

app.listen(4000, () => console.log("Webhook listener active on port 4000"));
```
