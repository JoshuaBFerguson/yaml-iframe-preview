# YAML Iframe Preview (VS Code)

Split-view YAML preview that streams YAML to a remote iframe, with a local demo.html fallback.

<img width="1379" height="487" alt="ss" src="https://github.com/user-attachments/assets/d80de1d6-d446-4bbc-a392-71e6a5e8e7b9" />

## Features

- Opens a side-by-side webview that embeds your app in an iframe.
- Streams YAML changes to the iframe via `postMessage` with a configurable debounce.
- Uses a bundled demo page when no remote HTTPS URL is configured.

## How it works

- You open a YAML file and run the command.
- A webview is created to the right, containing an iframe.
- The extension forwards YAML updates to the iframe using `postMessage`.

The message shape sent to the iframe is:

```json
{
  "type": "yaml:update",
  "payload": {
    "yaml": "...",
    "uri": "file:///...",
    "fileName": "/.../file.yaml",
    "languageId": "yaml",
    "version": 12
  }
}
```

## Usage

1. Open a `.yml` or `.yaml` file.
2. Run **Open YAML Iframe Preview** from the Command Palette.
3. The preview opens to the right and stays in sync as you edit.

## Configuration

These settings live under `yamlIframePreview` in your VS Code settings.

- `yamlIframePreview.remoteUrl` (string)
  - Remote HTTPS URL to load in the iframe. If unset or not HTTPS, the local demo is used.
- `yamlIframePreview.debounceMs` (number)
  - Debounce delay (ms) for sending YAML changes. Default: `300`.
- `yamlIframePreview.allowHttp` (boolean)
  - Allow loading the bundled demo over `http://localhost` when no remote HTTPS URL is set. Default: `true`.

## Remote iframe integration

Your remote page should listen for the `yaml:update` message and read `payload.yaml`.

Example:

```html
<script>
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.type !== 'yaml:update') return;

    // msg.payload.yaml contains the YAML text
    console.log('YAML:', msg.payload.yaml);
  });
</script>
```

## Demo page

When no `remoteUrl` is configured (or it is not HTTPS), the extension hosts `src/demo/index.html` on a local ephemeral port and loads it in the iframe. This is useful for quick testing or scaffolding your own integration.

## Development

```bash
npm install
npm run build
```

To run the extension locally:

1. Open this repo in VS Code.
2. Press `F5` to launch an Extension Development Host.
3. In the new window, open a YAML file and run **Open YAML Iframe Preview**.

## Notes and limitations

- Only HTTPS remote URLs are treated as remote; non-HTTPS values fall back to the local demo server.
- The iframe origin is used as the `postMessage` target origin when possible; local bundled resources use `*`.

## License

TBD
