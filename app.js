const editor = document.querySelector("#editor");
const selectionText = document.querySelector("#selectionText");
const selectionHint = document.querySelector("#selectionHint");
const translationInput = document.querySelector("#translationInput");
const insertButton = document.querySelector("#insertButton");
const undoButton = document.querySelector("#undoButton");
const translationForm = document.querySelector("#translationForm");
const historyList = document.querySelector("#historyList");
const sampleButton = document.querySelector("#sampleButton");
const clearButton = document.querySelector("#clearButton");
const googleTranslateLink = document.querySelector("#googleTranslateLink");

let savedRange = null;
let selectedText = "";
let lookupRequestId = 0;
let selectionUpdateTimer = null;
let lastSelectionSignature = "";
const undoStack = [];

const SELECTION_LOOKUP_DELAY_MS = 220;
const SAMPLE_TEXT =
  "Hola, soy un traductor de español. Intento ayudarte a entender palabras y frases sin tener que copiar y pegar todo en otro traductor. Espero que funcione. Todavía estoy en desarrollo, así que puede que algunas traducciones no sean perfectas. Si encuentras algún error o algo que no funciona correctamente, por favor házmelo saber. Esta es la primera aplicación de mi desarrollador.";

function resizeTranslationInput() {
  translationInput.style.height = "auto";
  translationInput.style.height = `${translationInput.scrollHeight}px`;
}

function updateGoogleTranslateLink(text = "") {
  const url = new URL("https://translate.google.com/");
  url.searchParams.set("sl", "es");
  url.searchParams.set("tl", "en");
  url.searchParams.set("op", "translate");

  if (text.trim()) {
    url.searchParams.set("text", text.trim());
  }

  googleTranslateLink.href = url.toString();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

async function fillTranslationForSelection(text) {
  const requestId = ++lookupRequestId;

  translationInput.value = "";
  resizeTranslationInput();
  translationInput.placeholder = "Looking up with Google Translate...";
  selectionHint.textContent = "Looking up the English translation with Google Translate...";

  try {
    const data = await postJson("/api/translate", { text });
    if (requestId !== lookupRequestId || text !== selectedText) return;

    translationInput.value = data.translation;
    resizeTranslationInput();
    translationInput.placeholder = "Type the English translation";
    selectionHint.textContent = "Edit the translation if needed, then insert it inline.";
  } catch (error) {
    if (requestId !== lookupRequestId || text !== selectedText) return;

    translationInput.placeholder = "Type the English translation";
    selectionHint.textContent =
      "Google Translate lookup failed. Open the Google Translate link below or type it manually.";
  }
}

function selectionIsInsideEditor(selection) {
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  return editor.contains(range.commonAncestorContainer);
}

function getSelectionSignature(range, text) {
  return [
    text,
    getNodePath(range.startContainer),
    range.startOffset,
    getNodePath(range.endContainer),
    range.endOffset
  ].join("|");
}

function getNodePath(node) {
  const path = [];
  let current = node;

  while (current && current !== editor) {
    const parent = current.parentNode;
    if (!parent) break;
    path.push(Array.prototype.indexOf.call(parent.childNodes, current));
    current = parent;
  }

  return path.reverse().join(".");
}

function scheduleSelectionUpdate() {
  window.clearTimeout(selectionUpdateTimer);
  selectionUpdateTimer = window.setTimeout(updateSelectionState, SELECTION_LOOKUP_DELAY_MS);
}

function updateSelectionState() {
  window.clearTimeout(selectionUpdateTimer);

  const selection = window.getSelection();

  if (!selectionIsInsideEditor(selection) || selection.isCollapsed) {
    return;
  }

  const text = selection.toString().trim();
  if (!text) return;

  const range = selection.getRangeAt(0);
  const signature = getSelectionSignature(range, text);
  if (signature === lastSelectionSignature) {
    return;
  }

  lastSelectionSignature = signature;
  savedRange = range.cloneRange();
  selectedText = text;

  selectionText.textContent = text;
  updateGoogleTranslateLink(text);
  fillTranslationForSelection(text);
  insertButton.disabled = false;
}

function restoreSelection() {
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedRange);
}

function insertAnnotation(event) {
  event?.preventDefault();

  const translation = translationInput.value.trim();
  if (!savedRange || !selectedText || !translation) {
    return;
  }

  restoreSelection();

  const span = document.createElement("span");
  span.className = "annotation";
  span.innerHTML = `${escapeHtml(selectedText)} <span class="gloss">(${escapeHtml(
    translation
  )})</span>`;

  savedRange.deleteContents();
  savedRange.insertNode(span);

  const trailingSpace = document.createTextNode(" ");
  span.after(trailingSpace);
  undoStack.push({
    span,
    trailingSpace,
    text: selectedText,
    historyItem: null
  });
  updateUndoState();

  const range = document.createRange();
  range.setStartAfter(trailingSpace);
  range.collapse(true);

  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  undoStack[undoStack.length - 1].historyItem = addHistoryItem(selectedText, translation);
  resetSelection();
  editor.focus();
}

function addHistoryItem(spanish, english) {
  const item = document.createElement("li");
  item.innerHTML = `<b>${escapeHtml(spanish)}</b> (${escapeHtml(english)})`;
  historyList.prepend(item);

  while (historyList.children.length > 8) {
    historyList.lastElementChild.remove();
  }

  return item;
}

function undoLastAnnotation() {
  const last = undoStack.pop();
  if (!last) return;

  const textNode = document.createTextNode(last.text);
  if (last.span.isConnected) {
    last.span.replaceWith(textNode);
  }

  if (last.trailingSpace.isConnected) {
    last.trailingSpace.remove();
  }

  if (last.historyItem?.isConnected) {
    last.historyItem.remove();
  }

  const range = document.createRange();
  range.setStartAfter(textNode);
  range.collapse(true);

  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  updateUndoState();
  resetSelection();
  editor.focus();
}

function updateUndoState() {
  undoButton.disabled = undoStack.length === 0;
}

function resetSelection() {
  window.clearTimeout(selectionUpdateTimer);
  lookupRequestId++;
  lastSelectionSignature = "";
  savedRange = null;
  selectedText = "";
  selectionText.textContent = "No word selected";
  selectionHint.textContent = "Highlight a Spanish word or phrase in the editor.";
  updateGoogleTranslateLink();
  translationInput.value = "";
  resizeTranslationInput();
  translationInput.placeholder = "translation appears here";
  insertButton.disabled = true;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    const escapes = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return escapes[character];
  });
}

document.addEventListener("selectionchange", scheduleSelectionUpdate);
editor.addEventListener("mouseup", updateSelectionState);
editor.addEventListener("pointerup", updateSelectionState);
editor.addEventListener("touchend", updateSelectionState);
editor.addEventListener("keyup", updateSelectionState);

translationForm.addEventListener("submit", insertAnnotation);
translationInput.addEventListener("input", resizeTranslationInput);
translationInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    insertAnnotation();
  }
});
undoButton.addEventListener("click", undoLastAnnotation);

sampleButton.addEventListener("click", () => {
  editor.textContent = SAMPLE_TEXT;
  undoStack.length = 0;
  historyList.innerHTML = "";
  updateUndoState();
  resetSelection();
  editor.focus();
});

clearButton.addEventListener("click", () => {
  editor.textContent = "";
  historyList.innerHTML = "";
  undoStack.length = 0;
  updateUndoState();
  resetSelection();
  editor.focus();
});

editor.addEventListener("input", () => {
  if (!editor.textContent.trim()) {
    resetSelection();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.altKey && event.key.toLowerCase() === "t") {
    event.preventDefault();
    insertAnnotation();
  }

  if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    undoLastAnnotation();
  }
});

editor.textContent = SAMPLE_TEXT;
updateUndoState();
updateGoogleTranslateLink();
