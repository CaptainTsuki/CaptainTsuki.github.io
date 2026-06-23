const http = require("http");
const fs = require("fs");
const path = require("path");

const publicDir = path.join(__dirname, "public");
const translationCache = new Map();
const pendingTranslations = new Map();

const HOST = process.env.HOST || "0.0.0.0";
const START_PORT = Number(process.env.PORT) || 5174;
const GOOGLE_TRANSLATE_TIMEOUT_MS = 12000;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Request body must be valid JSON."));
      }
    });
  });
}

function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.normalize(path.join(publicDir, pathname));

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(data);
  });
}

async function translateSpanishToEnglish(text) {
  const query = text.trim();
  if (!query) return "";

  const cacheKey = query.toLowerCase();
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }
  if (pendingTranslations.has(cacheKey)) {
    return pendingTranslations.get(cacheKey);
  }

  const translationPromise = requestGoogleTranslation(query)
    .then((translatedText) => {
      translationCache.set(cacheKey, translatedText);
      return translatedText;
    })
    .finally(() => {
      pendingTranslations.delete(cacheKey);
    });

  pendingTranslations.set(cacheKey, translationPromise);
  return translationPromise;
}

async function requestGoogleTranslation(query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_TRANSLATE_TIMEOUT_MS);
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "es");
  url.searchParams.set("tl", "en");
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", query);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Google Translate request failed: ${response.status} ${details}`);
    }

    const data = await response.json();
    const translatedText = extractGoogleTranslation(data);
    if (!translatedText) {
      throw new Error("Google Translate returned no translation.");
    }

    return translatedText;
  } finally {
    clearTimeout(timeout);
  }
}

function extractGoogleTranslation(data) {
  if (!Array.isArray(data?.[0])) return "";

  return data[0]
    .map((part) => (Array.isArray(part) ? part[0] : ""))
    .join("")
    .trim();
}

async function handleApi(request, response) {
  try {
    if (request.method === "POST" && request.url === "/api/translate") {
      const body = await readBody(request);
      const translation = await translateSpanishToEnglish(String(body.text ?? ""));
      sendJson(response, 200, { translation });
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    sendJson(response, 502, { error: error.message || "Translation failed." });
  }
}

function createServer() {
  return http.createServer((request, response) => {
    if (request.url.startsWith("/api/")) {
      handleApi(request, response);
      return;
    }

    serveStatic(request, response);
  });
}

function listen(port) {
  const server = createServer();

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      listen(port + 1);
      return;
    }

    throw error;
  });

  server.listen(port, HOST, () => {
    console.log(`Spanish Translation Annotator Web: http://${HOST}:${port}`);
  });
}

listen(START_PORT);
