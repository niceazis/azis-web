const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
try {
  const response = await fetch("/evidence/results.json", { cache: "no-store" });
  if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
    const report = await response.json();
    if (report.status === "pending") {
      // Keep the explicit pending state; there are no results to display.
    } else {
    if (report.schemaVersion !== 1 || report.status !== "live_run_recorded_pending_human_review" || !Array.isArray(report.records)) throw new Error("Unsupported report");
    document.getElementById("status").replaceChildren(node("h2", "Live responses recorded · human review pending"),
      node("p", `Recorded ${report.recordedResponses}/${report.totalCases} responses; ${report.failedRequests} request errors. Run: ${report.startedAt}.`),
      node("p", report.limitations, "muted"));
    for (const record of report.records) {
      const card = node("article", undefined, "card");
      card.append(node("h2", record.label), node("p", `Request: ${record.status}. Human verdict: ${record.humanVerdict}.`));
      const criteria = node("ul"); record.expectations.forEach(value => criteria.append(node("li", value))); card.append(criteria);
      if (record.status === "error") card.append(node("p", record.error));
      else {
        card.append(node("p", `Model: ${record.model}. Request time: ${record.elapsedMs} ms.`));
        const source = node("details"); source.append(node("summary", "Fictional input"), node("pre", record.source)); card.append(source);
        card.append(node("p", record.review.summary));
        for (const item of record.review.suggestions) {
          card.append(node("h3", item.title), node("p", item.noticed), node("p", item.suggested));
          item.evidence.forEach(quote => card.append(node("blockquote", quote)));
          card.append(node("p", `Owner: ${item.owner ?? "unknown"}. Source deadline: ${item.deadline ?? "unknown"}.`), node("pre", item.draft));
        }
        record.review.uncertainties.forEach(value => card.append(node("p", "Unknown: " + value, "muted")));
      }
      document.getElementById("records").append(card);
    }
    }
  }
} catch {
  document.getElementById("status").append(node("p", "A verified live report could not be loaded. No evaluation outcome is claimed.", "muted"));
}
