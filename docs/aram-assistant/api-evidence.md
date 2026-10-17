# Provider contract verification

Checked 2026-10-17 using Postman Orbit search/integrate and current official documentation. Orbit found both endpoint shapes but its examples reference legacy models and an older OpenAI image_url shape; official contracts take precedence. No live paid model calls made.

- OpenAI: https://developers.openai.com/api/docs/guides/images-vision?api-mode=chat — chat completions user content has text and image_url parts, image_url is an object with url containing a data:image/jpeg;base64 URI. Bearer Authorization. Keep model configurable; compatibility endpoint is intentionally chat/completions.
- Gemini: https://ai.google.dev/gemini-api/docs/image-understanding — generateContent accepts contents.parts text and inline_data (mime_type,data); x-goog-api-key header is supported, so do not place the key in the URL. Configurable version-root base URL and model.
- Public cards: https://hexaram.lol/data/mayhem/augment-catalog.json — source patch is a source declaration, not a claim of installed-client compatibility.

Reuse reference postman/contracts/providers.openapi.yaml and simulation mocks as local fixtures after checking shapes. Real HTTP fixture tests establish client/protocol/error behavior, not the behavior of arbitrary compatibility providers or real model recommendation quality.
