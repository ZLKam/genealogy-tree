const siteElements = {
  title: document.querySelector("#site-title"),
  lineage: document.querySelector("#lineage-title"),
  date: document.querySelector("#site-date"),
  editorNote: document.querySelector("#editor-note"),
  chapterNavigation: document.querySelector(".chapter-navigation"),
  chapterList: document.querySelector("#chapter-list"),
  chapterSections: document.querySelector("#chapter-sections"),
  searchDialog: document.querySelector("#search-dialog"),
  searchButton: document.querySelector("#open-search-button"),
  searchInput: document.querySelector("#global-search-input"),
  searchSuggestions: document.querySelector("#search-suggestions"),
  searchEmpty: document.querySelector("#search-empty"),
  searchResults: document.querySelector("#search-results"),
  searchResultCount: document.querySelector("#search-result-count"),
  searchResultList: document.querySelector("#search-result-list"),
  feedbackDialog: document.querySelector("#feedback-dialog"),
  feedbackForm: document.querySelector("#feedback-form"),
  feedbackLocation: document.querySelector("#feedback-location"),
  feedbackOriginal: document.querySelector("#feedback-original"),
  feedbackCorrection: document.querySelector("#feedback-correction"),
  feedbackNote: document.querySelector("#feedback-note"),
  feedbackStatus: document.querySelector("#feedback-status"),
  copyFeedbackButton: document.querySelector("#copy-feedback-button"),
  downloadFeedbackButton: document.querySelector("#download-feedback-button"),
};

let chapters = [];
let activeChapterId = "";
let chapterTrackingFrame = 0;
let searchRecords = [];
let searchSuggestionButtons = [];
let activeSearchSuggestionIndex = -1;

const feedbackRepository = "ZLKam/genealogy-tree";

const visibleChapterHeadingIds = new Set([
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "16",
  "25",
]);

function readLocalChapterData(id) {
  const source = document.querySelector("#local-chapter-data");

  if (!source) {
    return null;
  }

  try {
    const data = JSON.parse(source.textContent);
    return data && typeof data === "object" ? data[id] ?? null : null;
  } catch {
    return null;
  }
}

async function readJson(path) {
  const response = await fetch(path, { cache: "no-cache" });

  if (!response.ok) {
    throw new Error(String(response.status));
  }

  return response.json();
}

function replaceText(element, value) {
  if (element && typeof value === "string" && value.trim()) {
    element.textContent = value;
  }
}

function appendParagraphs(container, value) {
  const paragraphs = Array.isArray(value) ? value : [value];

  for (const paragraphText of paragraphs) {
    if (typeof paragraphText !== "string" || !paragraphText.trim()) {
      continue;
    }

    const paragraph = document.createElement("p");
    paragraph.textContent = paragraphText;
    container.append(paragraph);
  }
}

function appendEditorParagraph(container, text, className = "") {
  if (typeof text !== "string" || !text.trim()) {
    return;
  }

  const paragraph = document.createElement("p");
  paragraph.textContent = text;

  if (className) {
    paragraph.className = className;
  }

  container.append(paragraph);
}

function renderEditorNote(value) {
  siteElements.editorNote.replaceChildren();

  if (Array.isArray(value)) {
    appendParagraphs(siteElements.editorNote, value);
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const body = document.createElement("div");
  body.className = "editor-note-body";

  for (const paragraph of Array.isArray(value.paragraphs) ? value.paragraphs : []) {
    appendEditorParagraph(body, paragraph);
  }

  appendEditorParagraph(body, value.closing, "editor-note-closing");
  siteElements.editorNote.append(body);

  const meta = document.createElement("div");
  const verse = document.createElement("div");
  const signature = document.createElement("div");
  meta.className = "editor-note-meta";
  verse.className = "editor-note-verse";
  signature.className = "editor-note-signature";

  for (const line of Array.isArray(value.verse) ? value.verse : []) {
    appendEditorParagraph(verse, line);
  }

  for (const credit of Array.isArray(value.credits) ? value.credits : []) {
    if (!credit || typeof credit !== "object") {
      continue;
    }

    const creditLine = document.createElement("p");
    const name = document.createElement("span");
    const role = document.createElement("span");
    creditLine.className = "editor-note-credit";
    name.textContent = typeof credit.name === "string" ? credit.name : "";
    role.textContent = typeof credit.role === "string" ? credit.role : "";
    creditLine.append(name, role);
    signature.append(creditLine);
  }

  if (typeof value.date === "string" && value.date.trim()) {
    const date = document.createElement("time");
    date.className = "editor-note-date";
    date.textContent = value.date;

    if (typeof value.dateTime === "string" && value.dateTime.trim()) {
      date.dateTime = value.dateTime;
    }

    signature.append(date);
  }

  meta.append(verse, signature);
  siteElements.editorNote.append(meta);
}

function applySiteData(data) {
  if (!data || typeof data !== "object") {
    return;
  }

  replaceText(siteElements.title, data.title);
  replaceText(siteElements.lineage, data.lineage);
  replaceText(siteElements.date, data.date);

  if (typeof data.dateTime === "string" && data.dateTime.trim()) {
    siteElements.date.dateTime = data.dateTime;
  }

  renderEditorNote(data.editorNote ?? []);
}

function isChapterEntry(value) {
  return Boolean(
    value
      && typeof value === "object"
      && typeof value.id === "string"
      && value.id.trim()
      && typeof value.title === "string"
      && value.title.trim()
      && Number.isInteger(Number(value.originalPage))
      && Number(value.originalPage) > 0
      && typeof value.dataFile === "string"
      && /^\.?\/?data\/chapters\/[a-z0-9._-]+\.json$/i.test(value.dataFile)
      && !value.dataFile.includes(".."),
  );
}

function readStaticDirectory() {
  return Array.from(siteElements.chapterList.querySelectorAll("a[data-chapter-id]"))
    .map((link) => ({
      id: link.dataset.chapterId ?? "",
      title: link.querySelector(".toc-title")?.textContent ?? "",
      originalPage: Number(link.dataset.originalPage),
      dataFile: link.dataset.chapterFile ?? "",
    }))
    .filter(isChapterEntry);
}

function renderDirectory() {
  siteElements.chapterList.replaceChildren();

  for (const chapter of chapters.filter((entry) => visibleChapterHeadingIds.has(entry.id))) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    const label = document.createElement("span");

    link.href = `#${encodeURIComponent(chapter.id)}`;
    link.dataset.chapterId = chapter.id;
    link.dataset.chapterFile = chapter.dataFile;
    link.dataset.originalPage = String(chapter.originalPage);
    label.className = "toc-title";
    label.textContent = chapter.title;

    link.append(label);
    item.append(link);
    siteElements.chapterList.append(item);
  }
}

function navigationChapterId(id) {
  const chapterIndex = chapters.findIndex((entry) => entry.id === id);

  if (chapterIndex < 0) {
    return "";
  }

  for (let index = chapterIndex; index >= 0; index -= 1) {
    if (visibleChapterHeadingIds.has(chapters[index].id)) {
      return chapters[index].id;
    }
  }

  return "";
}

function appendChapterBlock(container, block) {
  if (typeof block === "string") {
    appendParagraphs(container, block);
    return;
  }

  if (!block || typeof block !== "object") {
    return;
  }

  if (typeof block.title === "string" && block.title.trim()) {
    const heading = document.createElement("h3");
    heading.textContent = block.title;
    container.append(heading);
  }

  appendParagraphs(container, block.paragraphs ?? block.text ?? []);

  if (Array.isArray(block.entries)) {
    const entries = block.entries.filter(
      (entry) => typeof entry === "string" && entry.trim(),
    );

    if (entries.length) {
      const list = document.createElement("ul");

      for (const entry of entries) {
        const item = document.createElement("li");
        item.textContent = entry;
        list.append(item);
      }

      container.append(list);
    }
  }
}

function appendRouteStops(container, stops) {
  const validStops = Array.isArray(stops)
    ? stops.filter((stop) => typeof stop === "string" && stop.trim())
    : [];

  validStops.forEach((stop, index) => {
    if (index > 0) {
      const arrow = document.createElement("span");
      arrow.className = "route-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "→";
      container.append(arrow);
    }

    const label = document.createElement("span");
    label.className = "route-stop";
    label.textContent = stop;
    container.append(label);
  });
}

function appendPlace(container, value, className = "family-place") {
  if (typeof value !== "string" || !value.trim()) {
    return;
  }

  const place = document.createElement("span");
  place.className = className;
  place.textContent = `（${value}）`;
  container.append(place);
}

const familyRankOrder = new Map([
  ["长", 0],
  ["次", 1],
  ["三", 2],
]);

function familyRankValue(node) {
  return familyRankOrder.get(node?.rank) ?? familyRankOrder.size;
}

function renderFamilyNode(node) {
  if (!node || typeof node !== "object") {
    return null;
  }

  const wrapper = document.createElement("div");
  const entry = document.createElement("div");
  const headline = document.createElement("div");
  wrapper.className = "family-node";
  entry.className = "family-entry";
  headline.className = "family-headline";

  if (typeof node.rank === "string" && node.rank.trim()) {
    const rank = document.createElement("span");
    rank.className = "family-rank";
    rank.textContent = node.rank;
    headline.append(rank);
  }

  if (typeof node.name === "string" && node.name.trim()) {
    const name = document.createElement("span");
    name.className = "family-name-entry";
    name.textContent = node.name;
    headline.append(name);
  }

  appendPlace(headline, node.place);

  if (typeof node.result === "string" && node.result.trim()) {
    const arrow = document.createElement("span");
    const result = document.createElement("span");
    arrow.className = "family-result-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";
    result.className = "family-result";
    result.textContent = node.result;
    headline.append(arrow, result);
    appendPlace(headline, node.resultPlace, "family-result-place");
  }

  entry.append(headline);

  if (Array.isArray(node.lines)) {
    const details = document.createElement("div");
    details.className = "family-details";

    for (const line of node.lines) {
      if (typeof line !== "string" || !line.trim()) {
        continue;
      }

      const detail = document.createElement("p");
      detail.textContent = line;
      details.append(detail);
    }

    if (details.childElementCount) {
      entry.append(details);
    }
  }

  if (typeof node.note === "string" && node.note.trim()) {
    const note = document.createElement("p");
    note.className = "family-note";
    note.textContent = `（${node.note}）`;
    entry.append(note);
  }

  wrapper.append(entry);

  const childNodes = Array.isArray(node.children)
    ? [...node.children]
        .sort((first, second) => familyRankValue(first) - familyRankValue(second))
        .map(renderFamilyNode)
        .filter(Boolean)
    : [];

  if (childNodes.length) {
    const children = document.createElement("div");
    children.className = "family-children";
    children.append(...childNodes);
    wrapper.append(children);
  }

  return wrapper;
}

function renderMigrationDiagram(container, data) {
  const diagram = document.createElement("div");
  diagram.className = "migration-diagram";

  const route = document.createElement("div");
  route.className = "migration-route";
  appendRouteStops(route, data.route);
  diagram.append(route);

  const founder = document.createElement("div");
  const founderLabel = document.createElement("span");
  const founderStops = document.createElement("span");
  founder.className = "founder-route";
  founderLabel.className = "founder-label";
  founderStops.className = "founder-stops";
  founderLabel.textContent = typeof data.founderLabel === "string" ? data.founderLabel : "";
  appendRouteStops(founderStops, data.founderRoute);
  founder.append(founderLabel, founderStops);
  diagram.append(founder);

  const tree = renderFamilyNode(data.tree);

  if (tree) {
    const treeContainer = document.createElement("div");
    treeContainer.className = "family-tree";
    treeContainer.append(tree);
    diagram.append(treeContainer);
  }

  container.append(diagram);
}

function appendGenerationSequence(container, generations) {
  const entries = Array.isArray(generations)
    ? generations.filter(
        (entry) => entry
          && typeof entry === "object"
          && typeof entry.text === "string"
          && entry.text.trim()
          && Number.isInteger(Number(entry.number)),
      )
    : [];

  entries.forEach((entry, index) => {
    const link = document.createElement("span");
    link.className = "generation-link";

    if (index > 0) {
      const arrow = document.createElement("span");
      arrow.className = "generation-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "→";
      link.append(arrow);
    }

    const step = document.createElement("span");
    const text = document.createElement("span");
    const number = document.createElement("span");
    step.className = "generation-step";
    text.className = "generation-name";
    number.className = "generation-number";
    text.textContent = entry.text;
    number.textContent = String(entry.number);
    step.append(text, number);
    link.append(step);
    container.append(link);
  });
}

function renderVerseSection(section) {
  if (!section || typeof section !== "object") {
    return null;
  }

  const wrapper = document.createElement("section");
  wrapper.className = "lineage-verse-section";

  if (typeof section.title === "string" && section.title.trim()) {
    const heading = document.createElement("h3");
    heading.textContent = section.title;
    wrapper.append(heading);
  }

  if (Array.isArray(section.rows)) {
    const grid = document.createElement("div");
    grid.className = "lineage-verse-grid";

    for (const row of section.rows) {
      if (!Array.isArray(row)) {
        continue;
      }

      for (const value of row) {
        if (typeof value !== "string" || !value.trim()) {
          continue;
        }

        const line = document.createElement("p");
        line.textContent = value;
        grid.append(line);
      }
    }

    if (grid.childElementCount) {
      wrapper.append(grid);
    }
  }

  if (Array.isArray(section.lines)) {
    const lines = document.createElement("div");
    lines.className = "lineage-verse-lines";

    for (const value of section.lines) {
      if (typeof value !== "string" || !value.trim()) {
        continue;
      }

      const line = document.createElement("p");
      line.textContent = value;
      lines.append(line);
    }

    if (lines.childElementCount) {
      wrapper.append(lines);
    }
  }

  if (Array.isArray(section.generations)) {
    const sequence = document.createElement("div");
    sequence.className = "generation-sequence branch-generation-sequence";
    appendGenerationSequence(sequence, section.generations);

    if (sequence.childElementCount) {
      wrapper.append(sequence);
    }
  }

  if (typeof section.note === "string" && section.note.trim()) {
    const note = document.createElement("p");
    note.className = "generation-note";
    note.textContent = section.note;
    wrapper.append(note);
  }

  return wrapper;
}

function renderGenerationRecord(container, data) {
  const record = document.createElement("div");
  const sequence = document.createElement("div");
  record.className = "generation-record";
  sequence.className = "generation-sequence main-generation-sequence";
  appendGenerationSequence(sequence, data.generations);

  if (sequence.childElementCount) {
    record.append(sequence);
  }

  for (const section of Array.isArray(data.sections) ? data.sections : []) {
    const verseSection = renderVerseSection(section);

    if (verseSection) {
      record.append(verseSection);
    }
  }

  container.append(record);
}

function renderHistoricalPeople(container, people) {
  const list = document.createElement("div");
  list.className = "historical-people";

  for (const person of people) {
    if (!person || typeof person.name !== "string" || typeof person.text !== "string") {
      continue;
    }

    const paragraph = document.createElement("p");
    const name = document.createElement("strong");
    const text = document.createElement("span");
    paragraph.className = "historical-person";
    name.textContent = `${person.name}${person.showColon === false ? "" : "："}`;
    text.textContent = person.text;
    paragraph.append(name, text);
    list.append(paragraph);
  }

  container.append(list);
}

function renderLineageRecord(container, data) {
  const record = document.createElement("div");
  record.className = "lineage-record";

  if (typeof data.heading === "string" && data.heading.trim()) {
    const heading = document.createElement("h3");
    heading.className = "lineage-record-heading";
    heading.textContent = data.heading;
    record.append(heading);
  }

  for (const entry of Array.isArray(data.entries) ? data.entries : []) {
    if (!entry || typeof entry.text !== "string" || !entry.text.trim()) {
      continue;
    }

    const row = document.createElement(entry.kind === "branch" ? "h3" : "p");
    const marker = document.createElement("span");
    const text = document.createElement("span");
    const level = Math.min(4, Math.max(0, Number.parseInt(entry.level, 10) || 0));
    row.className = entry.kind === "branch"
      ? "lineage-branch"
      : `lineage-row lineage-level-${level}`;
    marker.className = "lineage-marker";
    text.className = "lineage-text";
    marker.textContent = typeof entry.marker === "string" ? entry.marker : "";
    text.textContent = entry.text;

    if (marker.textContent) {
      row.classList.add("has-lineage-marker");
    }

    row.append(marker, text);
    record.append(row);
  }

  container.append(record);
}

function renderChapterContent(container, data) {
  container.replaceChildren();

  if (data?.diagram && typeof data.diagram === "object") {
    renderMigrationDiagram(container, data.diagram);
    return;
  }

  if (data?.generationRecord && typeof data.generationRecord === "object") {
    renderGenerationRecord(container, data.generationRecord);
    return;
  }

  if (Array.isArray(data?.historicalPeople)) {
    renderHistoricalPeople(container, data.historicalPeople);
    return;
  }

  const content = Array.isArray(data?.content)
    ? data.content
    : Array.isArray(data?.sections)
      ? data.sections
      : [];

  for (const block of content) {
    appendChapterBlock(container, block);
  }

  if (data?.lineageRecord && typeof data.lineageRecord === "object") {
    renderLineageRecord(container, data.lineageRecord);
  }
}

function normalizeSearchText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function searchTextIncludes(value, query) {
  return normalizeSearchText(value)
    .toLocaleLowerCase("zh-CN")
    .includes(normalizeSearchText(query).toLocaleLowerCase("zh-CN"));
}

function cleanSearchTerm(value) {
  return normalizeSearchText(value)
    .replace(/^(?:[☆★]|[①②③④⑤⑥⑦⑧⑨⑩]、?|[0-9一二三四五六七八九十]+[、.．])+/, "")
    .replace(/^(?:长|次|[一二三四五六七八九十]+)(?:子|女|孙|房)/, "")
    .replace(/^[：:，,；;、.．]+|[：:，,；;、.．]+$/g, "")
    .trim();
}

function addSearchRecord(element, text, metadata = {}) {
  const normalizedText = normalizeSearchText(text);

  if (!element || !normalizedText) {
    return;
  }

  searchRecords.push({
    element,
    text: normalizedText,
    chapterId: metadata.chapterId ?? "",
    chapterTitle: metadata.chapterTitle ?? "网页说明",
    originalPage: metadata.originalPage ?? "",
    suggestible: metadata.suggestible === true,
    order: searchRecords.length,
  });
}

function buildSearchIndex() {
  searchRecords = [];

  addSearchRecord(siteElements.lineage, siteElements.lineage?.textContent, {
    chapterTitle: "网页题名",
    suggestible: true,
  });

  for (const paragraph of document.querySelectorAll("#editor-note p")) {
    addSearchRecord(paragraph, paragraph.textContent, {
      chapterTitle: "编者说明",
    });
  }

  const contentSelectors = [
    ".chapter-content > p",
    ".chapter-content > h3",
    ".chapter-content > ul > li",
    ".route-stop",
    ".founder-label",
    ".family-headline",
    ".family-details p",
    ".family-note",
    ".generation-name",
    ".lineage-verse-section > h3",
    ".lineage-verse-grid p",
    ".lineage-verse-lines p",
    ".generation-note",
    ".historical-person",
    ".lineage-record-heading",
    ".lineage-branch",
    ".lineage-row",
  ].join(",");

  for (const chapter of chapters) {
    const section = document.getElementById(chapter.id);

    if (!section) {
      continue;
    }

    const metadata = {
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      originalPage: chapter.originalPage,
    };
    addSearchRecord(section, chapter.title, { ...metadata, suggestible: true });

    const recordedElements = new Set();

    for (const element of section.querySelectorAll(contentSelectors)) {
      if (recordedElements.has(element)) {
        continue;
      }

      recordedElements.add(element);
      addSearchRecord(element, element.textContent, {
        ...metadata,
        suggestible: element.matches([
          ".chapter-content > h3",
          ".family-headline",
          ".generation-name",
          ".historical-person",
          ".lineage-branch",
          ".lineage-row",
        ].join(",")),
      });
    }
  }
}

const searchRelationWords = [
  "具体不详",
  "移居",
  "入住",
  "就读",
  "毕业",
  "参加",
  "过继",
  "改名",
  "又叫",
  "无嗣",
  "早逝",
  "去向",
  "葬于",
  "工作",
  "不详",
  "娶",
  "嫁",
  "生",
  "育",
  "任",
  "当",
  "去",
  "到",
  "葬",
  "坐",
  "号",
  "在",
];

function isolateSearchField(value, query) {
  const text = cleanSearchTerm(value);
  const normalizedQuery = normalizeSearchText(query);
  const foldedText = text.toLocaleLowerCase("zh-CN");
  const foldedQuery = normalizedQuery.toLocaleLowerCase("zh-CN");
  const queryIndex = foldedText.indexOf(foldedQuery);

  if (queryIndex < 0) {
    return "";
  }

  const queryEnd = queryIndex + foldedQuery.length;
  let start = 0;
  let end = text.length;

  for (const word of searchRelationWords) {
    let position = text.indexOf(word);

    while (position >= 0) {
      const wordEnd = position + word.length;

      if (wordEnd <= queryIndex) {
        start = Math.max(start, wordEnd);
      } else if (position >= queryEnd) {
        end = Math.min(end, position);
      }

      position = text.indexOf(word, position + word.length);
    }
  }

  return cleanSearchTerm(text.slice(start, end));
}

function extractSearchTerms(value, query) {
  const text = normalizeSearchText(value);
  const normalizedQuery = normalizeSearchText(query);
  const terms = [];
  const seen = new Set();
  const addTerm = (term) => {
    const cleaned = cleanSearchTerm(term);

    if (
      !cleaned
      || cleaned.length > 8
      || !/^[\p{Script=Han}A-Za-z·]+$/u.test(cleaned)
      || !searchTextIncludes(cleaned, normalizedQuery)
      || seen.has(cleaned)
    ) {
      return;
    }

    seen.add(cleaned);
    terms.push(cleaned);
  };

  const publicNamePattern = /[\p{Script=Han}]{1,6}?公/gu;
  let publicNameMatch = publicNamePattern.exec(text);

  while (publicNameMatch) {
    addTerm(publicNameMatch[0]);
    publicNameMatch = publicNamePattern.exec(text);
  }

  for (const piece of text.split(/[，,。；;：:、→—（）()《》〈〉\[\]【】\s]+/u)) {
    if (!searchTextIncludes(piece, normalizedQuery)) {
      continue;
    }

    addTerm(isolateSearchField(piece, normalizedQuery));
  }

  if (text.length <= 8) {
    addTerm(text);
  }

  return terms;
}

function matchingSearchRecords(term) {
  return searchRecords.filter((record) => searchTextIncludes(record.text, term));
}

function clearSearchOutput() {
  siteElements.searchSuggestions.replaceChildren();
  siteElements.searchSuggestions.hidden = true;
  siteElements.searchEmpty.hidden = true;
  siteElements.searchResults.hidden = true;
  siteElements.searchResultList.replaceChildren();
  siteElements.searchInput.setAttribute("aria-expanded", "false");
  searchSuggestionButtons = [];
  activeSearchSuggestionIndex = -1;
}

function setActiveSearchSuggestion(index) {
  if (!searchSuggestionButtons.length) {
    return;
  }

  const normalizedIndex = (index + searchSuggestionButtons.length)
    % searchSuggestionButtons.length;

  searchSuggestionButtons.forEach((button, buttonIndex) => {
    button.setAttribute(
      "aria-selected",
      buttonIndex === normalizedIndex ? "true" : "false",
    );
  });

  activeSearchSuggestionIndex = normalizedIndex;
  searchSuggestionButtons[normalizedIndex].scrollIntoView({ block: "nearest" });
}

function renderSearchSuggestions(value) {
  const query = normalizeSearchText(value);
  clearSearchOutput();

  if (!query) {
    return;
  }

  const suggestions = [];
  const seen = new Set();

  for (const record of searchRecords) {
    if (!record.suggestible) {
      continue;
    }

    if (!searchTextIncludes(record.text, query)) {
      continue;
    }

    for (const term of extractSearchTerms(record.text, query)) {
      if (seen.has(term)) {
        continue;
      }

      seen.add(term);
      suggestions.push(term);
    }
  }

  if (!suggestions.length && matchingSearchRecords(query).length) {
    suggestions.push(query);
  }

  if (!suggestions.length) {
    siteElements.searchEmpty.hidden = false;
    return;
  }

  for (const term of suggestions) {
    const button = document.createElement("button");
    const label = document.createElement("span");
    const count = document.createElement("small");
    const resultCount = matchingSearchRecords(term).length;
    button.type = "button";
    button.className = "search-suggestion";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", "false");
    label.textContent = term;
    count.textContent = `${resultCount}处`;
    button.append(label, count);
    button.addEventListener("click", () => {
      selectSearchTerm(term);
    });
    siteElements.searchSuggestions.append(button);
  }

  searchSuggestionButtons = Array.from(
    siteElements.searchSuggestions.querySelectorAll(".search-suggestion"),
  );
  siteElements.searchSuggestions.hidden = false;
  siteElements.searchInput.setAttribute("aria-expanded", "true");
}

function appendHighlightedSearchText(container, value, term) {
  const text = normalizeSearchText(value);
  const foldedText = text.toLocaleLowerCase("zh-CN");
  const foldedTerm = normalizeSearchText(term).toLocaleLowerCase("zh-CN");
  let cursor = 0;
  let matchIndex = foldedText.indexOf(foldedTerm, cursor);

  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      container.append(document.createTextNode(text.slice(cursor, matchIndex)));
    }

    const mark = document.createElement("mark");
    mark.textContent = text.slice(matchIndex, matchIndex + foldedTerm.length);
    container.append(mark);
    cursor = matchIndex + foldedTerm.length;
    matchIndex = foldedText.indexOf(foldedTerm, cursor);
  }

  if (cursor < text.length) {
    container.append(document.createTextNode(text.slice(cursor)));
  }
}

function searchRecordLocation(record) {
  if (!record.chapterId) {
    return record.chapterTitle;
  }

  const page = record.originalPage ? ` · 原谱第${record.originalPage}页` : "";
  return `${record.chapterTitle}${page}`;
}

function closeUtilityDialog(dialog) {
  if (!dialog?.open) {
    return;
  }

  if (typeof dialog.close === "function") {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
}

function openUtilityDialog(dialog) {
  if (!dialog || dialog.open) {
    return;
  }

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function revealSearchRecord(record) {
  const target = record?.element;

  if (!target) {
    return;
  }

  closeUtilityDialog(siteElements.searchDialog);

  if (record.chapterId) {
    window.history.replaceState(null, "", `#${encodeURIComponent(record.chapterId)}`);
    markCurrentChapter(navigationChapterId(record.chapterId));
  }

  window.requestAnimationFrame(() => {
    target.classList.remove("search-target-flash");
    void target.offsetWidth;
    target.classList.add("search-target-flash");
    target.scrollIntoView({
      behavior: chapterMotionBehavior("smooth"),
      block: target.classList.contains("chapter-panel") ? "start" : "center",
    });

    window.setTimeout(() => {
      target.classList.remove("search-target-flash");
    }, 2400);
  });
}

function renderSearchResults(term) {
  const results = matchingSearchRecords(term);
  siteElements.searchResultList.replaceChildren();
  siteElements.searchResultCount.textContent = `${results.length}条`;

  for (const record of results) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const location = document.createElement("span");
    const text = document.createElement("span");
    button.type = "button";
    button.className = "search-result-button";
    location.className = "search-result-location";
    text.className = "search-result-text";
    location.textContent = searchRecordLocation(record);
    appendHighlightedSearchText(text, record.text, term);
    button.append(location, text);
    button.addEventListener("click", () => {
      revealSearchRecord(record);
    });
    item.append(button);
    siteElements.searchResultList.append(item);
  }

  siteElements.searchEmpty.hidden = Boolean(results.length);
  siteElements.searchResults.hidden = !results.length;
}

function selectSearchTerm(term) {
  siteElements.searchInput.value = term;
  siteElements.searchSuggestions.hidden = true;
  siteElements.searchInput.setAttribute("aria-expanded", "false");
  renderSearchResults(term);
}

function currentFeedbackLocation() {
  const chapterId = chapterAtReadingLine();
  const chapter = chapters.find((entry) => entry.id === chapterId);

  if (!chapter) {
    return "编者说明";
  }

  return `${chapter.title}（原谱第${chapter.originalPage}页）`;
}

function feedbackText() {
  const pageUrl = window.location.protocol === "file:"
    ? "本地族谱网页"
    : window.location.href;
  const note = normalizeSearchText(siteElements.feedbackNote.value);
  const lines = [
    "## 族谱纠错",
    "",
    `- 所在位置：${normalizeSearchText(siteElements.feedbackLocation.value) || "未填写"}`,
    `- 目前原文或错字：${normalizeSearchText(siteElements.feedbackOriginal.value)}`,
    `- 建议改为：${normalizeSearchText(siteElements.feedbackCorrection.value)}`,
  ];

  if (note) {
    lines.push(`- 补充说明：${note}`);
  }

  lines.push("", `来源网页：${pageUrl}`);
  return lines.join("\n");
}

function feedbackIssueUrl() {
  const original = normalizeSearchText(siteElements.feedbackOriginal.value);
  const titleDetail = original ? `：${original.slice(0, 24)}` : "";
  const query = new URLSearchParams({
    title: `[族谱纠错]${titleDetail}`,
    body: feedbackText(),
  });
  return `https://github.com/${feedbackRepository}/issues/new?${query.toString()}`;
}

function validateFeedbackForm() {
  if (siteElements.feedbackForm.reportValidity()) {
    return true;
  }

  siteElements.feedbackStatus.textContent = "请先填写目前原文和建议改法。";
  return false;
}

async function copyFeedbackText() {
  if (!validateFeedbackForm()) {
    return;
  }

  const text = feedbackText();

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const temporary = document.createElement("textarea");
      temporary.value = text;
      temporary.setAttribute("readonly", "");
      temporary.style.position = "fixed";
      temporary.style.opacity = "0";
      document.body.append(temporary);
      temporary.select();

      if (!document.execCommand("copy")) {
        throw new Error("copy failed");
      }

      temporary.remove();
    }

    siteElements.feedbackStatus.textContent = "反馈内容已复制。";
  } catch {
    siteElements.feedbackStatus.textContent = "浏览器未能自动复制，请改用“下载反馈文本”。";
  }
}

function downloadFeedbackText() {
  if (!validateFeedbackForm()) {
    return;
  }

  const file = new Blob([feedbackText()], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = URL.createObjectURL(file);
  link.download = `族谱纠错-${date}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  siteElements.feedbackStatus.textContent = "反馈文本已下载。";
}

function openFeedbackDialog() {
  if (!normalizeSearchText(siteElements.feedbackLocation.value)) {
    siteElements.feedbackLocation.value = currentFeedbackLocation();
  }

  siteElements.feedbackStatus.textContent = "";
  openUtilityDialog(siteElements.feedbackDialog);
  window.setTimeout(() => siteElements.feedbackOriginal.focus(), 0);
}

function initializeUtilities() {
  siteElements.searchButton.addEventListener("click", () => {
    openUtilityDialog(siteElements.searchDialog);
    window.setTimeout(() => {
      siteElements.searchInput.focus();
      siteElements.searchInput.select();
    }, 0);
  });

  for (const button of document.querySelectorAll("[data-open-feedback]")) {
    button.addEventListener("click", openFeedbackDialog);
  }

  for (const button of document.querySelectorAll("[data-dialog-close]")) {
    button.addEventListener("click", () => {
      closeUtilityDialog(document.getElementById(button.dataset.dialogClose));
    });
  }

  for (const dialog of [siteElements.searchDialog, siteElements.feedbackDialog]) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        closeUtilityDialog(dialog);
      }
    });
  }

  siteElements.searchInput.addEventListener("input", () => {
    renderSearchSuggestions(siteElements.searchInput.value);
  });

  siteElements.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSearchSuggestion(activeSearchSuggestionIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSearchSuggestion(activeSearchSuggestionIndex - 1);
    } else if (event.key === "Enter" && activeSearchSuggestionIndex >= 0) {
      event.preventDefault();
      searchSuggestionButtons[activeSearchSuggestionIndex].click();
    }
  });

  siteElements.feedbackForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!validateFeedbackForm()) {
      return;
    }

    window.open(feedbackIssueUrl(), "_blank", "noopener,noreferrer");
    siteElements.feedbackStatus.textContent = "已打开预填好的 GitHub Issue，请登录后确认提交。";
  });

  siteElements.copyFeedbackButton.addEventListener("click", copyFeedbackText);
  siteElements.downloadFeedbackButton.addEventListener("click", downloadFeedbackText);
  siteElements.feedbackForm.addEventListener("input", () => {
    siteElements.feedbackStatus.textContent = "";
  });
}

function currentChapterId() {
  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return "";
  }
}

function chapterMotionBehavior(behavior) {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : behavior;
}

function centerChapterLink(id, behavior = "smooth") {
  const link = Array.from(
    siteElements.chapterList.querySelectorAll("a[data-chapter-id]"),
  ).find((entry) => entry.dataset.chapterId === id);

  if (!link) {
    return;
  }

  const listRect = siteElements.chapterList.getBoundingClientRect();
  const linkRect = link.getBoundingClientRect();
  const currentLeft = siteElements.chapterList.scrollLeft;
  const desiredLeft = currentLeft
    + linkRect.left
    - listRect.left
    - ((listRect.width - linkRect.width) / 2);
  const maximumLeft = Math.max(
    0,
    siteElements.chapterList.scrollWidth - siteElements.chapterList.clientWidth,
  );
  const targetLeft = Math.min(maximumLeft, Math.max(0, desiredLeft));

  siteElements.chapterList.scrollTo({
    left: targetLeft,
    behavior: chapterMotionBehavior(behavior),
  });
}

function markCurrentChapter(id, { center = true, behavior = "smooth" } = {}) {
  for (const link of siteElements.chapterList.querySelectorAll("a")) {
    if (link.dataset.chapterId === id) {
      link.setAttribute("aria-current", "true");
    } else {
      link.removeAttribute("aria-current");
    }
  }

  activeChapterId = id;

  if (center && id) {
    centerChapterLink(id, behavior);
  }
}

function chapterAtReadingLine() {
  const sections = Array.from(
    siteElements.chapterSections.querySelectorAll(".chapter-panel"),
  );

  if (!sections.length) {
    return "";
  }

  const navigationBottom = siteElements.chapterNavigation
    ? siteElements.chapterNavigation.getBoundingClientRect().bottom
    : 0;
  const readingLine = Math.min(
    window.innerHeight,
    Math.max(0, navigationBottom + 12),
  );
  let currentSection = sections[0];

  for (const section of sections) {
    if (section.getBoundingClientRect().top > readingLine) {
      break;
    }

    currentSection = section;
  }

  return currentSection.dataset.chapterId ?? "";
}

function updateChapterFromScroll() {
  chapterTrackingFrame = 0;
  const id = navigationChapterId(chapterAtReadingLine());

  if (!id || id === activeChapterId) {
    return;
  }

  markCurrentChapter(id);
}

function scheduleChapterTracking() {
  if (chapterTrackingFrame) {
    return;
  }

  chapterTrackingFrame = window.requestAnimationFrame(updateChapterFromScroll);
}

async function loadChapterData(chapter) {
  const localData = readLocalChapterData(chapter.id);

  if (window.location.protocol === "file:") {
    return localData ?? {};
  }

  try {
    const data = await readJson(chapter.dataFile);
    return data && typeof data === "object" ? data : {};
  } catch {
    return localData ?? {};
  }
}

function createChapterSection(chapter, data) {
  const section = document.createElement("section");
  const header = document.createElement("header");
  const firstRule = document.createElement("span");
  const heading = document.createElement("h2");
  const lastRule = document.createElement("span");
  const content = document.createElement("div");
  const chapterTitle = typeof data?.title === "string" && data.title.trim()
    ? data.title
    : chapter.title;
  const shouldShowHeading = visibleChapterHeadingIds.has(chapter.id);
  section.className = "archive-section chapter-panel";
  section.id = chapter.id;
  section.dataset.chapterId = chapter.id;
  header.className = "section-heading";
  firstRule.setAttribute("aria-hidden", "true");
  lastRule.setAttribute("aria-hidden", "true");
  heading.id = `chapter-heading-${chapter.id}`;
  heading.textContent = chapterTitle;
  content.className = "chapter-content";
  header.append(firstRule, heading, lastRule);

  if (shouldShowHeading) {
    section.setAttribute("aria-labelledby", heading.id);
    section.append(header);
  } else {
    section.classList.add("chapter-panel-untitled");
    section.setAttribute("aria-label", chapterTitle);
  }

  section.append(content);
  renderChapterContent(content, data ?? {});
  return section;
}

async function renderAllChapters() {
  const chapterData = await Promise.all(chapters.map(loadChapterData));
  const fragment = document.createDocumentFragment();

  chapters.forEach((chapter, index) => {
    fragment.append(createChapterSection(chapter, chapterData[index]));
  });

  siteElements.chapterSections.replaceChildren(fragment);
}

function scrollToChapter(section) {
  const scroll = () => {
    window.requestAnimationFrame(() => {
      section.scrollIntoView();
    });
  };

  scroll();

  if (document.fonts?.ready) {
    document.fonts.ready.then(scroll).catch(() => {
      // 字体载入失败时保留已经完成的定位。
    });
  }
}

function updateCurrentChapter(shouldScroll, behavior = "smooth") {
  const id = currentChapterId();
  const chapter = chapters.find((entry) => entry.id === id);

  if (!chapter) {
    scheduleChapterTracking();
    return;
  }

  markCurrentChapter(navigationChapterId(chapter.id), { behavior });

  if (!shouldScroll) {
    return;
  }

  const section = document.getElementById(chapter.id);

  if (section) {
    scrollToChapter(section);
  }
}

async function initialize() {
  chapters = readStaticDirectory();
  renderDirectory();

  const [siteResult, chapterResult] = await Promise.allSettled([
    readJson("./data/site.json"),
    readJson("./data/chapters.json"),
  ]);

  if (siteResult.status === "fulfilled") {
    applySiteData(siteResult.value);
  }

  if (chapterResult.status === "fulfilled" && Array.isArray(chapterResult.value)) {
    chapters = chapterResult.value.filter(isChapterEntry);
    renderDirectory();
  }

  await renderAllChapters();
  buildSearchIndex();
  initializeUtilities();
  const requestedChapter = chapters.find((entry) => entry.id === currentChapterId());

  if (requestedChapter) {
    updateCurrentChapter(true, "auto");
  } else {
    const initialId = navigationChapterId(chapterAtReadingLine() || chapters[0]?.id || "");
    markCurrentChapter(initialId, { behavior: "auto" });
  }

  scheduleChapterTracking();
}

window.addEventListener("hashchange", () => {
  updateCurrentChapter(true);
});

window.addEventListener("scroll", scheduleChapterTracking, { passive: true });

window.addEventListener("resize", () => {
  scheduleChapterTracking();

  if (activeChapterId) {
    window.requestAnimationFrame(() => {
      centerChapterLink(activeChapterId, "auto");
    });
  }
});

initialize();
