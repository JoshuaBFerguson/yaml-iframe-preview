import * as vscode from "vscode";
import * as http from "http";
import * as fs from "fs/promises";

const PREVIEW_VIEW_TYPE = "yamlIframePreview.preview";

export function activate(context: vscode.ExtensionContext) {
  const previewByDoc = new Map<string, { panel: vscode.WebviewPanel; disposable: vscode.Disposable }>();

  const openCmd = vscode.commands.registerCommand("yamlIframePreview.open", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage("No active editor.");
      return;
    }

    const doc = editor.document;
    const isYaml =
      doc.languageId === "yaml" ||
      doc.uri.fsPath.toLowerCase().endsWith(".yml") ||
      doc.uri.fsPath.toLowerCase().endsWith(".yaml");

    if (!isYaml) {
      vscode.window.showWarningMessage("Open a YAML (.yml/.yaml) file to use this preview.");
      return;
    }

    const key = doc.uri.toString();
    const existing = previewByDoc.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }

    // Force split: YAML left, webview right
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: true });

    const demoRoot = vscode.Uri.joinPath(context.extensionUri, "src", "demo");
    const panel = vscode.window.createWebviewPanel(
      PREVIEW_VIEW_TYPE,
      `Preview: ${vscode.workspace.asRelativePath(doc.uri)}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        // Allow the iframe to load the bundled demo HTML.
        localResourceRoots: [demoRoot]
      }
    );

    const cfg = vscode.workspace.getConfiguration("yamlIframePreview");
    const remoteUrl = cfg.get<string>("remoteUrl", "");
    const debounceMs = Math.max(0, cfg.get<number>("debounceMs", 300));
    const allowHttp = !!cfg.get<boolean>("allowHttp", true);

    let demoServer: http.Server | undefined;
    let demoUrl: string | undefined;
    if (!isHttpsUrl(remoteUrl)) {
      const started = await startDemoServer(context);
      demoServer = started.server;
      demoUrl = started.url;
    }

    panel.webview.html = getWebviewHtml(panel.webview, context, remoteUrl, demoUrl, allowHttp);

    const sendUpdate = debounce(() => {
      panel.webview.postMessage({
        type: "yaml:update",
        payload: {
          yaml: doc.getText(),
          uri: doc.uri.toString(),
          fileName: doc.fileName,
          languageId: doc.languageId,
          version: doc.version
        }
      });
    }, debounceMs);

    // initial send
    sendUpdate();

    const disposable = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== key) return;
      sendUpdate();
    });

    panel.onDidDispose(() => {
      disposable.dispose();
      if (demoServer) demoServer.close();
      previewByDoc.delete(key);
    });

    previewByDoc.set(key, { panel, disposable });
  });

  context.subscriptions.push(openCmd);
}

export function deactivate() {
  // nothing
}

function isHttpsUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveAppSrc(
  webview: vscode.Webview,
  context: vscode.ExtensionContext,
  remoteUrl: string,
  demoUrl: string | undefined,
  allowHttp: boolean
): { src: string; frameSrcCsp: string; targetOrigin: string } {
  if (isHttpsUrl(remoteUrl)) {
    const origin = new URL(remoteUrl).origin;
    return { src: remoteUrl, frameSrcCsp: origin, targetOrigin: origin };
  }

  if (allowHttp && demoUrl) {
    const origin = new URL(demoUrl).origin;
    return { src: demoUrl, frameSrcCsp: origin, targetOrigin: origin };
  }

  // Fallback: bundled local demo.html in src/
  const demoPath = vscode.Uri.joinPath(context.extensionUri, "src", "./demo/index.html");
  const demoUri = webview.asWebviewUri(demoPath);
  // When posting to a local webview resource iframe, "*" is simplest.
  // Some VS Code builds still use the vscode-resource: scheme for webview URIs,
  // so allow both in the frame-src CSP.
  return {
    src: demoUri.toString(),
    frameSrcCsp: `${webview.cspSource} vscode-resource:`,
    targetOrigin: "*"
  };
}

function getWebviewHtml(
  webview: vscode.Webview,
  context: vscode.ExtensionContext,
  remoteUrl: string,
  demoUrl: string | undefined,
  allowHttp: boolean
): string {
  const nonce = getNonce();
  const { src, frameSrcCsp, targetOrigin } = resolveAppSrc(
    webview,
    context,
    remoteUrl,
    demoUrl,
    allowHttp
  );

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="
      default-src 'none';
      img-src ${webview.cspSource} https: data:;
      style-src 'unsafe-inline' ${webview.cspSource};
      script-src 'nonce-${nonce}';
      frame-src ${frameSrcCsp};
    " />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>YAML Iframe Preview</title>
  <style>
    html, body { height: 100%; padding: 0; margin: 0; }
    .wrap { height: 100%; display: flex; flex-direction: column; }
    .bar {
      padding: 8px 10px;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      font-size: 12px;
      border-bottom: 1px solid rgba(127,127,127,0.2);
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
    }
    .muted { opacity: 0.75; }
    iframe { flex: 1; width: 100%; border: 0; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="bar">
      <div>
        <strong>Mode:</strong>
        <code>${escapeHtml(isHttpsUrl(remoteUrl) ? "remote" : "local")}</code>
        <span class="muted">— ${escapeHtml(isHttpsUrl(remoteUrl) ? remoteUrl : "src/demo/index.html")}</span>
      </div>
      <div class="muted">Forwarding YAML via <code>postMessage</code></div>
    </div>

    <iframe id="app" src="${escapeHtml(src)}"></iframe>
  </div>

  <script nonce="${nonce}">
    const iframe = document.getElementById('app');

    // Extension -> Webview: receive YAML updates
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || msg.type !== 'yaml:update') return;

      // Webview -> Iframe: forward YAML
      iframe?.contentWindow?.postMessage(msg, ${JSON.stringify(targetOrigin)});
    });
  </script>
</body>
</html>`;
}

async function startDemoServer(
  context: vscode.ExtensionContext
): Promise<{ server: http.Server; url: string }> {
  const demoFile = vscode.Uri.joinPath(context.extensionUri, "src", "demo", "index.html");
  const demoPath = demoFile.fsPath;
  const server = http.createServer(async (req, res) => {
    const urlPath = req.url ? req.url.split("?")[0] : "/";
    if (urlPath !== "/" && urlPath !== "/index.html") {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    try {
      const html = await fs.readFile(demoPath, "utf8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
    } catch {
      res.statusCode = 500;
      res.end("Failed to load demo");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    server.close();
    throw new Error("Demo server failed to bind");
  }

  const url = `http://127.0.0.1:${addr.port}/index.html`;
  console.log(url)
  return { server, url };
}

function debounce<T extends (...args: any[]) => void>(fn: T, delayMs: number): T {
  let timer: NodeJS.Timeout | undefined;
  return function (this: any, ...args: any[]) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delayMs);
  } as T;
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
