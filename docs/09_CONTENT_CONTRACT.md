# 09 — Contract for AI-generated interactive HTML lessons

This document governs any HTML produced in ChatGPT or elsewhere and uploaded to Moja Nauka. It does not connect ChatGPT directly to the service. The app treats content as opaque and does not harvest quiz answers/scores.

## 1. Authoring rules

- Exactly one valid UTF-8 HTML5 file: `<!doctype html>`, `<html lang="pl">`, `<meta charset="utf-8">`, viewport meta for phones/tablets.
- All CSS inside `<style>`, JS inside `<script>`, imagery inside inline SVG or `data:image/jpeg|png|webp|svg+xml` where safe. Avoid external assets, CDN, fonts, `@import`, HTTP(S) URLs, modules, imports and build-time JS bundles.
- No iframes, workers, service workers, popups, forms that submit, file input, remote API calls, browser storage (`localStorage`, `sessionStorage`, IndexedDB), cookies or external navigation. Avoid browser APIs restricted in opaque-origin sandbox.
- No `eval`, `new Function`, dynamically imported scripts or code execution based on postMessage/external origins. JS is limited to in-document interactions.
- No clickable external links needed to finish lesson. Keep all lesson navigation within document; do not use `location.href`, `window.open` or top navigation.
- Responsive portrait/landscape, keyboard accessible, focus-visible, large controls, motion reduction, Polish labels, accessible quiz feedback. Avoid remote fonts or permissions.
- Max HTML **20 MiB**, typical target ≤2 MiB. Base64 expands image bytes by approximately one third; optimize images before embedding. Check actual UTF-8 file byte length, not source image size.
- Content-authored scripts can modify their own DOM for quiz/animations; they must not need parent app access. No quiz-results bridge or other host API in v1.

## 2. Viewer execution environment

The trusted shell reads the verified original UTF-8 Blob and losslessly decodes it into the `srcdoc` of an **opaque-origin** inner iframe with exactly `sandbox="allow-scripts"`. The inner document inherits the verified passive wrapper's resource policy. The wrapper permits authored inline JS/CSS and embedded data assets while blocking ordinary remote dependencies, network APIs and workers. The trusted shell retains its strict CSP. The exact source file and its authoring rules are unchanged.

The authoring contract prohibits authored frames and external navigation. Browser-local descendants and self-frame navigation remain subject to the bounded limitations in ADR-017. Lessons have no access to host data or reliable application storage and must work without a network connection.

## 3. Suggested lesson generation request

> Create a complete interactive HTML5 lesson in Polish for a grade-4 learner about [topic]. Include clear explanations, responsive diagrams and an interactive 10–15 question quiz with immediate answer feedback. Return ONE standalone UTF-8 HTML file, containing all CSS/JS inline and all images as data URIs or inline SVG. No CDN, external links/resources, imports, iframe, workers, browser storage, cookies, eval, remote requests or any navigation outside this document. It must work completely offline within a sandboxed opaque-origin iframe on Android Chrome and iPad/iPhone Safari Home Screen, where inline JavaScript is allowed but privileged browser origin storage and remote resource access are not. Include accessible keyboard/touch controls, Polish text, portrait/landscape layouts and no required video/audio permissions.

The section/question counts are examples, not mandatory standardized content format.

## 4. Validation strategy

- **Server:** authoritative UTF-8/size/SHA-256 check plus structural validator for expected HTML document, obvious external scripts/images/links/styles, `iframe`, worker, dangerous URLs, storage expectations and disallowed navigation patterns. Return a clear `422` report identifying detectable problems; do not claim a static linter understands arbitrary JS behavior.
- **Admin:** optional local preflight for convenience; never replaces server verification. Sandbox preview with own CSP.
- **Browser viewer:** CSP/sandbox limit the damage of missed unsafe behavior. A malicious HTML can still attempt self-frame navigation; this risk is documented and unacceptable as a proof of fully network-disabled hostile code.
- **Regression:** verify the actual fixture and newly generated lessons on the real target browser matrix. A visually correct initial slide is insufficient; test navigation, every interactive section and quiz feedback.

## 5. Reference fixture

Expected path `fixtures/rocks-soil.html` (must be supplied by owner). Expected 333,033 bytes and SHA-256 `7590b609c72a5e454887707ed16a5e3de6bec759ea1fc2e88247f9654265566c`, with nine embedded JPEGs and inline JS navigation/quiz. The file was **not** included in uploaded docs; verify real bytes and execute the whole lesson before claiming G1 success. Never generate a substitute and call it the reference.

Extending permitted APIs/content formats requires a new contract version, review of viewer CSP/security and new browser regression tests.
