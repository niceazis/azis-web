const $ = id => document.getElementById(id);
const output = $("review-output");
const input = $("review-input");
const analyzeButton = $("review-analyze");
let configured = false;
let activeRequest = null;
let cases = [];
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function paragraph(parent, label, value) {
  const p = node("p");
  p.append(node("strong", label + ": "), node("span", value));
  parent.append(p);
}
function clearReview() {
  if (activeRequest) activeRequest.abort();
  activeRequest = null;
  analyzeButton.disabled = !configured;
  analyzeButton.textContent = "Analyze with Claude";
  output.replaceChildren();
}
function renderReview(result) {
  output.replaceChildren(node("div", "Claude analysis · human review required", "pill"));
  output.append(node("p", result.review.summary), node("p", result.notice, "mini"));
  if (result.review.uncertainties.length) {
    const box = node("div", undefined, "suggestion");
    box.append(node("h3", "Unknowns to confirm"));
    const list = node("ul");
    result.review.uncertainties.forEach(value => list.append(node("li", value)));
    box.append(list); output.append(box);
  }
  if (!result.review.suggestions.length) output.append(node("p", "No follow-up proposed. Check the source before relying on this result.", "mini"));
  result.review.suggestions.forEach(item => {
    const card = node("article", undefined, "suggestion");
    card.append(node("h3", item.title));
    paragraph(card, "Noticed", item.noticed);
    paragraph(card, "Suggested", item.suggested);
    paragraph(card, "Owner", item.owner ?? "Unknown — confirm before assigning");
    paragraph(card, "Source deadline", item.deadline ?? "Unknown — confirm timing");
    card.append(node("h4", "Source evidence"));
    item.evidence.forEach(quote => card.append(node("blockquote", quote)));
    card.append(node("p", "Quotes match the input. Their interpretation still requires your review.", "mini"));
    const label = node("label", "Editable follow-up draft", "mini");
    const draft = node("textarea"); draft.value = item.draft;
    draft.style.minHeight = "100px"; draft.setAttribute("aria-label", "Follow-up draft: " + item.title);
    label.append(draft); card.append(label);
    const actions = node("div", undefined, "actions");
    const accept = node("button", "Accept draft", "primary");
    const dismiss = node("button", "Dismiss");
    const copy = node("button", "Copy draft"); copy.disabled = true;
    const status = node("p", "Review the evidence and draft before accepting.", "mini");
    accept.addEventListener("click", () => {
      copy.disabled = false; accept.disabled = true; dismiss.disabled = true;
      status.textContent = "Draft accepted on this page only. Copy it and send it yourself.";
    });
    dismiss.addEventListener("click", () => {
      accept.disabled = true; dismiss.disabled = true; draft.disabled = true;
      status.textContent = "Dismissed. No action was taken.";
    });
    draft.addEventListener("input", () => {
      copy.disabled = true; accept.disabled = false; dismiss.disabled = false;
      status.textContent = "Draft changed. Review and accept it again before copying.";
    });
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(draft.value);
        status.textContent = "Draft copied. No message was sent.";
      } catch {
        draft.focus(); draft.select();
        status.textContent = "Clipboard unavailable. Copy the selected draft manually.";
      }
    });
    actions.append(accept, dismiss, copy); card.append(actions, status); output.append(card);
  });
}
analyzeButton.addEventListener("click", async () => {
  const text = input.value.trim();
  const token = $("review-access").value;
  if (!text || !token) { output.textContent = "Enter a conversation and reviewer access code first."; return; }
  clearReview();
  const controller = new AbortController(); activeRequest = controller;
  analyzeButton.disabled = true; analyzeButton.textContent = "Analyzing…";
  output.textContent = "Reviewing work context with Claude…";
  const timeout = setTimeout(() => controller.abort(), 35000);
  try {
    const response = await fetch("/api/analyze", {
      method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: JSON.stringify({ text }),
    });
    const result = await response.json();
    if (activeRequest !== controller) return;
    if (!response.ok) { output.textContent = result.error ?? "Analysis unavailable. Please try again."; return; }
    renderReview(result);
  } catch {
    if (activeRequest === controller) output.textContent = controller.signal.aborted ? "Analysis timed out. Please try again." : "Analysis unavailable. The public simulation is still available.";
  } finally {
    clearTimeout(timeout);
    if (activeRequest === controller) {
      activeRequest = null; analyzeButton.disabled = !configured; analyzeButton.textContent = "Analyze with Claude";
    }
  }
});
input.addEventListener("input", clearReview);
$("review-clear").addEventListener("click", () => { clearReview(); input.value = ""; $("review-access").value = ""; });
$("load-review-case").addEventListener("click", () => {
  const item = cases.find(x => x.id === $("review-case").value);
  if (!item) return;
  clearReview(); input.value = item.text;
  output.append(node("p", "Fictional case — expected behavior for evaluation, not a measured result.", "mini"));
  const list = node("ul"); item.expectations.forEach(value => list.append(node("li", value))); output.append(list);
});
async function loadCases() {
  try {
    const response = await fetch("/demo/cases.json");
    if (!response.ok) throw new Error("Cases unavailable");
    cases = await response.json();
    $("review-case").replaceChildren(...cases.map(item => {
      const option = node("option", item.label); option.value = item.id; return option;
    }));
  } catch { $("review-case").replaceChildren(node("option", "Cases unavailable")); }
}
async function checkStatus() {
  try {
    const response = await fetch("/api/status");
    if (!response.ok) throw new Error("Status unavailable");
    const status = await response.json(); configured = status.claudeConfigured === true;
    $("claude-status").textContent = configured ? "Configured · reviewer access required" : "Server activation pending";
    $("review-help").textContent = configured ? "Use an AZIS reviewer code. Live model quality and customer value still require validation." : "Claude code is implemented but is not activated on this deployment. You can load the fictional cases and use the public simulation above.";
  } catch {
    $("claude-status").textContent = "Availability unverified";
    $("review-help").textContent = "The Claude service could not be checked. The public simulation above remains available.";
  }
  analyzeButton.disabled = !configured;
}
await Promise.allSettled([loadCases(), checkStatus()]);
