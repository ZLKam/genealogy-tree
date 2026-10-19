"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_WIDTH = 146;
const NODE_HEIGHT = 58;
const HORIZONTAL_GAP = 32;
const VERTICAL_STEP = 116;

const elements = {
  stage: document.querySelector("#tree-stage"),
  svg: document.querySelector("#tree-svg"),
  viewport: document.querySelector("#tree-viewport"),
  links: document.querySelector("#tree-links"),
  adoptionLinks: document.querySelector("#tree-adoption-links"),
  nodes: document.querySelector("#tree-nodes"),
  loading: document.querySelector("#tree-loading"),
  error: document.querySelector("#tree-error"),
  visibleStatus: document.querySelector("#visible-status"),
  personCount: document.querySelector("#person-count"),
  generationCount: document.querySelector("#generation-count"),
  sourceCount: document.querySelector("#source-count"),
  chapterCount: document.querySelector("#chapter-count"),
  reviewCount: document.querySelector("#review-count"),
  generationRange: document.querySelector("#generation-range"),
  generationOutput: document.querySelector("#generation-output"),
  showAllGenerations: document.querySelector("#show-all-generations"),
  searchInput: document.querySelector("#tree-search-input"),
  searchResults: document.querySelector("#tree-search-results"),
  searchStatus: document.querySelector("#search-result-status"),
  zoomIn: document.querySelector("#zoom-in"),
  zoomOut: document.querySelector("#zoom-out"),
  fitTree: document.querySelector("#fit-tree"),
  resetTree: document.querySelector("#reset-tree"),
  restoreFullTree: document.querySelector("#restore-full-tree"),
  personPanel: document.querySelector("#person-panel"),
  personName: document.querySelector("#person-name"),
  personGeneration: document.querySelector("#person-generation"),
  personPanelBody: document.querySelector("#person-panel-body"),
  closePersonPanel: document.querySelector("#close-person-panel"),
  reviewDialog: document.querySelector("#review-dialog"),
  reviewList: document.querySelector("#review-list"),
  openReviewDialog: document.querySelector("#open-review-dialog"),
  closeReviewDialog: document.querySelector("#close-review-dialog"),
};

const state = {
  data: null,
  people: new Map(),
  sources: new Map(),
  issuesByPerson: new Map(),
  children: new Map(),
  parent: new Map(),
  treeLinks: new Map(),
  adoptionLinks: [],
  collapsed: new Set(),
  selectedId: null,
  isolatedRootId: null,
  generationLimit: 12,
  maxGeneration: 24,
  positions: new Map(),
  visibleIds: new Set(),
  bounds: null,
  view: { x: 0, y: 0, scale: 1 },
  activePointers: new Map(),
  panStart: null,
  pinchStart: null,
  searchMatches: [],
  searchIndex: -1,
};

function createElement(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function createSvgElement(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeSearch(value) {
  return String(value ?? "").trim().toLocaleLowerCase("zh-CN").replace(/\s+/gu, "");
}

function personLabel(person) {
  if (!person) return "未知人物";
  return person.aliases.length ? `${person.name}（又载：${person.aliases.join("、")}）` : person.name;
}

function genderLabel(gender) {
  if (gender === "male") return "男";
  if (gender === "female") return "女";
  return "性别未载";
}

function relationKey(from, to) {
  return `${from}>${to}`;
}

async function loadTreeData() {
  if (window.__FAMILY_TREE_DATA__ && typeof window.__FAMILY_TREE_DATA__ === "object") {
    return window.__FAMILY_TREE_DATA__;
  }
  const response = await fetch("./data/family-tree.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`Unable to load family tree: ${response.status}`);
  return response.json();
}

function buildIndexes(data) {
  state.data = data;
  state.people = new Map(data.people.map((person) => [person.id, person]));
  state.sources = new Map(data.sources.map((source) => [source.id, source]));
  state.children.clear();
  state.parent.clear();
  state.treeLinks.clear();
  state.adoptionLinks = [];
  state.issuesByPerson.clear();

  for (const person of data.people) state.children.set(person.id, []);
  for (const link of data.links) {
    if (link.type === "parent-child" || link.type === "context") {
      state.children.get(link.from)?.push(link.to);
      state.parent.set(link.to, link.from);
      state.treeLinks.set(relationKey(link.from, link.to), link);
    } else if (link.type === "adoptive") {
      state.adoptionLinks.push(link);
    }
  }
  for (const issue of data.issues) {
    for (const personId of issue.personIds) {
      const list = state.issuesByPerson.get(personId) ?? [];
      list.push(issue);
      state.issuesByPerson.set(personId, list);
    }
  }

  const generations = data.people
    .map((person) => person.generation)
    .filter(Number.isInteger);
  state.maxGeneration = Math.max(...generations, 1);
  state.generationLimit = Math.min(12, state.maxGeneration);
  state.selectedId = data.meta.rootPersonId;
}

function updateSummary() {
  const { stats } = state.data;
  elements.personCount.textContent = stats.people.toLocaleString("zh-CN");
  elements.generationCount.textContent = state.maxGeneration.toLocaleString("zh-CN");
  elements.sourceCount.textContent = stats.sourceRecords.toLocaleString("zh-CN");
  elements.chapterCount.textContent = stats.chapters.toLocaleString("zh-CN");
  elements.reviewCount.textContent = stats.reviewIssues.toLocaleString("zh-CN");
  elements.generationRange.max = String(state.maxGeneration);
  elements.generationRange.value = String(state.generationLimit);
  elements.generationOutput.value = String(state.generationLimit);
}

function buildVisibleHierarchy() {
  const rootId = state.isolatedRootId ?? state.data.meta.rootPersonId;
  const visited = new Set();
  const forcedPath = selectedPath();

  function visit(personId) {
    if (visited.has(personId)) return null;
    const person = state.people.get(personId);
    if (!person) return null;
    visited.add(personId);
    const allChildren = state.children.get(personId) ?? [];
    const canExpand = !state.collapsed.has(personId)
      && (forcedPath.has(personId) || person.synthetic || person.generation == null || person.generation < state.generationLimit);
    const visibleChildren = canExpand
      ? allChildren
        .filter((childId) => {
          const child = state.people.get(childId);
          return child && (
            forcedPath.has(childId)
            || child.synthetic
            || child.generation == null
            || child.generation <= state.generationLimit
          );
        })
        .map(visit)
        .filter(Boolean)
      : [];
    return {
      id: personId,
      person,
      children: visibleChildren,
      totalChildren: allChildren.length,
      hiddenChildren: allChildren.length - visibleChildren.length,
    };
  }

  return visit(rootId);
}

function layoutHierarchy(root) {
  state.positions.clear();
  state.visibleIds.clear();
  let leafCursor = 0;
  const rootGeneration = root.person.generation ?? 1;

  function place(node) {
    const childPositions = node.children.map(place);
    let x;
    if (!childPositions.length) {
      x = leafCursor * (NODE_WIDTH + HORIZONTAL_GAP);
      leafCursor += 1;
    } else {
      x = (childPositions[0].x + childPositions[childPositions.length - 1].x) / 2;
    }
    const generation = node.person.generation ?? rootGeneration;
    const y = Math.max(0, generation - rootGeneration) * VERTICAL_STEP;
    const position = { x, y, node };
    state.positions.set(node.id, position);
    state.visibleIds.add(node.id);
    return position;
  }

  place(root);
  const values = [...state.positions.values()];
  const minX = Math.min(...values.map((position) => position.x)) - NODE_WIDTH / 2 - 36;
  const maxX = Math.max(...values.map((position) => position.x)) + NODE_WIDTH / 2 + 36;
  const minY = Math.min(...values.map((position) => position.y)) - NODE_HEIGHT / 2 - 42;
  const maxY = Math.max(...values.map((position) => position.y)) + NODE_HEIGHT / 2 + 52;
  state.bounds = { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function selectedPath() {
  const ids = new Set();
  let cursor = state.selectedId;
  while (cursor && !ids.has(cursor)) {
    ids.add(cursor);
    cursor = state.parent.get(cursor);
  }
  return ids;
}

function edgePath(parentPosition, childPosition) {
  const startY = parentPosition.y + NODE_HEIGHT / 2;
  const endY = childPosition.y - NODE_HEIGHT / 2;
  const middleY = startY + (endY - startY) * 0.52;
  return [
    `M ${parentPosition.x} ${startY}`,
    `C ${parentPosition.x} ${middleY}, ${childPosition.x} ${middleY}, ${childPosition.x} ${endY}`,
  ].join(" ");
}

function adoptionPath(from, to) {
  const offset = 9;
  return `M ${from.x + NODE_WIDTH / 2 - offset} ${from.y} C ${from.x + NODE_WIDTH} ${from.y}, ${to.x - NODE_WIDTH} ${to.y}, ${to.x - NODE_WIDTH / 2 + offset} ${to.y}`;
}

function nodeMeta(person, node) {
  const details = [];
  if (person.generation) details.push(`第${person.generation}世`);
  if (person.spouses.length) details.push(`配${person.spouses.length}`);
  const unnamed = person.unnamedChildren.male + person.unnamedChildren.female + person.unnamedChildren.unknown;
  if (unnamed) details.push(`未载名${unnamed}`);
  if (!details.length && node.hiddenChildren) details.push(`后代${node.hiddenChildren}`);
  return details.slice(0, 2).join(" · ");
}

function renderLinks(pathIds) {
  const fragment = document.createDocumentFragment();
  for (const [key, link] of state.treeLinks) {
    if (!state.visibleIds.has(link.from) || !state.visibleIds.has(link.to)) continue;
    const parentPosition = state.positions.get(link.from);
    const childPosition = state.positions.get(link.to);
    const path = createSvgElement("path", {
      d: edgePath(parentPosition, childPosition),
      class: "tree-edge",
    });
    if (link.confidence !== "confirmed" || link.type === "context") path.classList.add("is-review");
    if (pathIds.has(link.from) && pathIds.has(link.to) && state.parent.get(link.to) === link.from) {
      path.classList.add("is-path");
    }
    path.dataset.relation = key;
    fragment.append(path);
  }
  elements.links.replaceChildren(fragment);

  const adoptionFragment = document.createDocumentFragment();
  for (const link of state.adoptionLinks) {
    if (!state.visibleIds.has(link.from) || !state.visibleIds.has(link.to)) continue;
    const from = state.positions.get(link.from);
    const to = state.positions.get(link.to);
    const path = createSvgElement("path", {
      d: adoptionPath(from, to),
      class: "adoption-edge",
    });
    const title = createSvgElement("title");
    title.textContent = link.label || "继嗣／过继关系";
    path.append(title);
    adoptionFragment.append(path);
  }
  elements.adoptionLinks.replaceChildren(adoptionFragment);
}

function renderNodes(pathIds) {
  const fragment = document.createDocumentFragment();
  for (const [personId, position] of state.positions) {
    const { node } = position;
    const { person } = node;
    const group = createSvgElement("g", {
      class: "person-node",
      transform: `translate(${position.x} ${position.y})`,
      tabindex: "0",
      role: "button",
      "aria-label": `${personLabel(person)}，${person.generation ? `第${person.generation}世` : "世代未载"}`,
    });
    group.dataset.personId = personId;
    if (pathIds.has(personId)) group.classList.add("is-path");
    if (state.selectedId === personId) group.classList.add("is-selected");
    if (person.confidence !== "confirmed" || state.issuesByPerson.has(personId)) group.classList.add("is-review");
    if (person.synthetic) group.classList.add("is-synthetic");

    const title = createSvgElement("title");
    title.textContent = `${personLabel(person)}${person.statuses.length ? `｜${person.statuses.join("、")}` : ""}`;
    group.append(title);

    group.append(createSvgElement("rect", {
      class: "node-card",
      x: -NODE_WIDTH / 2,
      y: -NODE_HEIGHT / 2,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      rx: 7,
    }));

    const name = createSvgElement("text", { class: "node-name", x: 0, y: -3 });
    name.textContent = person.name;
    group.append(name);
    const meta = createSvgElement("text", { class: "node-meta", x: 0, y: 17 });
    meta.textContent = nodeMeta(person, node);
    group.append(meta);

    if (!person.synthetic && person.gender !== "unknown") {
      group.append(createSvgElement("circle", {
        class: "node-gender",
        cx: -NODE_WIDTH / 2 + 12,
        cy: -NODE_HEIGHT / 2 + 12,
        r: 7,
      }));
      const gender = createSvgElement("text", {
        class: "node-gender-text",
        x: -NODE_WIDTH / 2 + 12,
        y: -NODE_HEIGHT / 2 + 15,
      });
      gender.textContent = person.gender === "male" ? "男" : "女";
      group.append(gender);
    }

    if (node.totalChildren) {
      group.append(createSvgElement("circle", {
        class: "node-expand-dot",
        cx: 0,
        cy: NODE_HEIGHT / 2 + 8,
        r: 8,
      }));
      const symbol = createSvgElement("text", {
        class: "node-expand-symbol",
        x: 0,
        y: NODE_HEIGHT / 2 + 11.5,
      });
      symbol.textContent = node.hiddenChildren || state.collapsed.has(personId) ? "+" : "−";
      group.append(symbol);
    }

    group.addEventListener("click", (event) => {
      event.stopPropagation();
      selectPerson(personId, { openPanel: true });
    });
    group.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      toggleDescendants(personId);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        selectPerson(personId, { openPanel: true });
      } else if (event.key === " ") {
        event.preventDefault();
        toggleDescendants(personId);
      }
    });
    fragment.append(group);
  }
  elements.nodes.replaceChildren(fragment);
}

function renderTree(options = {}) {
  const root = buildVisibleHierarchy();
  if (!root) return;
  layoutHierarchy(root);
  const pathIds = selectedPath();
  renderLinks(pathIds);
  renderNodes(pathIds);
  applyViewTransform();
  elements.visibleStatus.textContent = state.isolatedRootId
    ? `正在查看 ${state.people.get(state.isolatedRootId)?.name ?? "所选人物"} 支系 · ${state.visibleIds.size.toLocaleString("zh-CN")} 人`
    : `当前显示 ${state.visibleIds.size.toLocaleString("zh-CN")} / ${state.data.stats.people.toLocaleString("zh-CN")} 人`;
  elements.restoreFullTree.hidden = !state.isolatedRootId;
  if (options.fit) requestAnimationFrame(fitTree);
}

function applyViewTransform() {
  const { x, y, scale } = state.view;
  elements.viewport.setAttribute("transform", `translate(${x} ${y}) scale(${scale})`);
}

function fitTree() {
  if (!state.bounds) return;
  const width = elements.stage.clientWidth;
  const height = elements.stage.clientHeight;
  if (!width || !height) return;
  const padding = width < 680 ? 32 : 70;
  const scale = clamp(
    Math.min((width - padding * 2) / state.bounds.width, (height - padding * 2) / state.bounds.height),
    0.025,
    1.18,
  );
  state.view.scale = scale;
  state.view.x = width / 2 - (state.bounds.minX + state.bounds.maxX) / 2 * scale;
  state.view.y = padding - state.bounds.minY * scale;
  applyViewTransform();
}

function zoomAt(factor, clientX, clientY) {
  const rect = elements.stage.getBoundingClientRect();
  const pointX = clientX - rect.left;
  const pointY = clientY - rect.top;
  const oldScale = state.view.scale;
  const nextScale = clamp(oldScale * factor, 0.025, 2.4);
  const worldX = (pointX - state.view.x) / oldScale;
  const worldY = (pointY - state.view.y) / oldScale;
  state.view.scale = nextScale;
  state.view.x = pointX - worldX * nextScale;
  state.view.y = pointY - worldY * nextScale;
  applyViewTransform();
}

function centerPerson(personId, options = {}) {
  const position = state.positions.get(personId);
  if (!position) return;
  const width = elements.stage.clientWidth;
  const height = elements.stage.clientHeight;
  const scale = clamp(options.scale ?? Math.max(state.view.scale, 0.82), 0.16, 1.35);
  state.view.scale = scale;
  state.view.x = width / 2 - position.x * scale;
  state.view.y = Math.min(height * 0.38, 220) - position.y * scale;
  applyViewTransform();
}

function expandAncestorPath(personId) {
  let cursor = personId;
  while (cursor) {
    state.collapsed.delete(cursor);
    cursor = state.parent.get(cursor);
  }
}

function selectPerson(personId, options = {}) {
  const person = state.people.get(personId);
  if (!person) return;
  state.selectedId = personId;
  expandAncestorPath(personId);
  renderTree();
  if (options.center) requestAnimationFrame(() => centerPerson(personId));
  if (options.openPanel) renderPersonPanel(person);
}

function toggleDescendants(personId) {
  const children = state.children.get(personId) ?? [];
  if (!children.length) return;
  if (state.collapsed.has(personId)) state.collapsed.delete(personId);
  else state.collapsed.add(personId);
  renderTree();
  requestAnimationFrame(() => centerPerson(personId, { scale: state.view.scale }));
}

function sourceForPerson(person) {
  const seen = new Set();
  return person.sources
    .map((sourceId) => state.sources.get(sourceId))
    .filter((source) => {
      if (!source || seen.has(source.text)) return false;
      seen.add(source.text);
      return true;
    });
}

function relativeButton(personId, prefix = "") {
  const person = state.people.get(personId);
  const button = createElement("button", "relative-button", `${prefix}${personLabel(person)}`);
  button.type = "button";
  button.addEventListener("click", () => selectPerson(personId, { center: true, openPanel: true }));
  return button;
}

function renderPersonPanel(person) {
  elements.personPanel.hidden = false;
  elements.personName.textContent = personLabel(person);
  elements.personGeneration.textContent = person.generation
    ? `入岑第 ${person.generation} 世 · ${genderLabel(person.gender)}`
    : genderLabel(person.gender);
  const fragment = document.createDocumentFragment();

  const facts = createElement("div", "person-facts");
  for (const spouse of person.spouses) facts.append(createElement("span", "fact-chip", spouse));
  for (const status of person.statuses) facts.append(createElement("span", "fact-chip", status));
  if (person.confidence !== "confirmed") facts.append(createElement("span", "fact-chip is-review", "资料待核"));
  const unnamed = person.unnamedChildren;
  if (unnamed.male) facts.append(createElement("span", "fact-chip", `未载名儿子 ×${unnamed.male}`));
  if (unnamed.female) facts.append(createElement("span", "fact-chip", `未载名女儿 ×${unnamed.female}`));
  if (unnamed.unknown) facts.append(createElement("span", "fact-chip", `未载名子女 ×${unnamed.unknown}`));
  if (facts.childElementCount) fragment.append(facts);

  const parents = [];
  const parentId = state.parent.get(person.id);
  if (parentId) parents.push(parentId);
  const children = state.children.get(person.id) ?? [];
  if (parents.length || children.length) {
    const section = createElement("section", "person-section");
    section.append(createElement("h3", "", "上下代关系"));
    const list = createElement("div", "relative-list");
    for (const id of parents) list.append(relativeButton(id, "上代 · "));
    for (const id of children) list.append(relativeButton(id, "后代 · "));
    section.append(list);
    fragment.append(section);
  }

  const issues = state.issuesByPerson.get(person.id) ?? [];
  if (issues.length) {
    const section = createElement("section", "person-section");
    section.append(createElement("h3", "", "核对提示"));
    const list = createElement("ul", "person-issue-list");
    for (const issue of issues) list.append(createElement("li", "", issue.message));
    section.append(list);
    fragment.append(section);
  }

  const sources = sourceForPerson(person);
  if (sources.length) {
    const section = createElement("section", "person-section");
    section.append(createElement("h3", "", "族谱原文依据"));
    const list = createElement("ol", "source-list");
    for (const source of sources) {
      const item = createElement("li", "source-item");
      const header = createElement("header");
      const sourceLabel = createElement("span", "", `第${source.chapterId}章 · 原第${source.page}页`);
      const sourceLink = createElement("a", "", "查看原章节");
      sourceLink.href = `./index.html#${encodeURIComponent(source.chapterId)}`;
      header.append(sourceLabel, sourceLink);
      item.append(header, createElement("p", "", source.text));
      list.append(item);
    }
    section.append(list);
    fragment.append(section);
  }

  if (children.length) {
    const actions = createElement("div", "person-actions");
    const toggle = createElement(
      "button",
      "",
      state.collapsed.has(person.id) ? "展开此人后代" : "收起此人后代",
    );
    toggle.type = "button";
    toggle.addEventListener("click", () => {
      toggleDescendants(person.id);
      renderPersonPanel(person);
    });
    const isolate = createElement("button", "", "只看此支");
    isolate.type = "button";
    isolate.addEventListener("click", () => {
      state.isolatedRootId = person.id;
      state.collapsed.delete(person.id);
      renderTree({ fit: true });
    });
    actions.append(toggle, isolate);
    fragment.append(actions);
  }

  elements.personPanelBody.replaceChildren(fragment);
}

function closePersonPanel() {
  elements.personPanel.hidden = true;
}

function renderReviewDialog() {
  const fragment = document.createDocumentFragment();
  for (const issue of state.data.issues) {
    const item = createElement("li");
    item.append(document.createTextNode(issue.message));
    if (issue.chapterId) {
      item.append(createElement("small", "", `第${issue.chapterId}章 · 原第${issue.page ?? "—"}页`));
    }
    if (issue.personIds.length) {
      const person = state.people.get(issue.personIds.at(-1));
      const button = createElement("button", "review-focus", `在树中查看 ${person?.name ?? "相关人物"}`);
      button.type = "button";
      button.addEventListener("click", () => {
        elements.reviewDialog.close();
        selectPerson(issue.personIds.at(-1), { center: true, openPanel: true });
      });
      item.append(button);
    }
    fragment.append(item);
  }
  elements.reviewList.replaceChildren(fragment);
}

function sourceHint(person) {
  const source = person.sources.map((id) => state.sources.get(id)).find(Boolean);
  return source ? `第${source.chapterId}章 · 原第${source.page}页` : "资料出处待核";
}

function findPeople(query) {
  const normalized = normalizeSearch(query);
  if (!normalized) return [];
  return [...state.people.values()]
    .filter((person) => !person.synthetic)
    .map((person) => {
      const names = [person.name, ...person.aliases].map(normalizeSearch);
      let score = 99;
      if (names.some((name) => name === normalized)) score = 0;
      else if (names.some((name) => name.startsWith(normalized))) score = 1;
      else if (names.some((name) => name.includes(normalized))) score = 2;
      return { person, score };
    })
    .filter((result) => result.score < 99)
    .sort((a, b) => a.score - b.score
      || (a.person.generation ?? 99) - (b.person.generation ?? 99)
      || a.person.name.localeCompare(b.person.name, "zh-CN"))
    .slice(0, 18)
    .map((result) => result.person);
}

function renderSearchResults(query) {
  state.searchMatches = findPeople(query);
  state.searchIndex = -1;
  elements.searchResults.replaceChildren();
  if (!normalizeSearch(query)) {
    elements.searchResults.hidden = true;
    elements.searchInput.setAttribute("aria-expanded", "false");
    elements.searchStatus.textContent = "";
    return;
  }
  elements.searchStatus.textContent = `${state.searchMatches.length} 项`;
  if (!state.searchMatches.length) {
    const empty = createElement("p", "search-result", "没有找到相符姓名");
    elements.searchResults.append(empty);
  } else {
    for (const person of state.searchMatches) {
      const button = createElement("button", "search-result");
      button.type = "button";
      button.role = "option";
      button.dataset.personId = person.id;
      button.append(
        createElement("strong", "", person.name),
        createElement("span", "", person.generation ? `第${person.generation}世` : "世代待核"),
        createElement("small", "", `${person.aliases.length ? `又载：${person.aliases.join("、")} · ` : ""}${sourceHint(person)}`),
      );
      button.addEventListener("click", () => chooseSearchResult(person.id));
      elements.searchResults.append(button);
    }
  }
  elements.searchResults.hidden = false;
  elements.searchInput.setAttribute("aria-expanded", "true");
}

function chooseSearchResult(personId) {
  const person = state.people.get(personId);
  if (!person) return;
  state.isolatedRootId = null;
  elements.searchInput.value = person.name;
  elements.searchResults.hidden = true;
  elements.searchInput.setAttribute("aria-expanded", "false");
  selectPerson(personId, { center: true, openPanel: true });
}

function updateSearchSelection() {
  const buttons = [...elements.searchResults.querySelectorAll("button[data-person-id]")];
  buttons.forEach((button, index) => {
    const selected = index === state.searchIndex;
    button.setAttribute("aria-selected", selected ? "true" : "false");
    if (selected) button.scrollIntoView({ block: "nearest" });
  });
}

function initializeInteractions() {
  elements.generationRange.addEventListener("input", () => {
    state.generationLimit = Number(elements.generationRange.value);
    elements.generationOutput.value = String(state.generationLimit);
    state.collapsed.clear();
    renderTree({ fit: true });
  });
  elements.showAllGenerations.addEventListener("click", () => {
    state.generationLimit = state.maxGeneration;
    elements.generationRange.value = String(state.maxGeneration);
    elements.generationOutput.value = String(state.maxGeneration);
    state.collapsed.clear();
    renderTree({ fit: true });
  });

  elements.searchInput.addEventListener("input", () => renderSearchResults(elements.searchInput.value));
  elements.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && state.searchMatches.length) {
      event.preventDefault();
      state.searchIndex = (state.searchIndex + 1) % state.searchMatches.length;
      updateSearchSelection();
    } else if (event.key === "ArrowUp" && state.searchMatches.length) {
      event.preventDefault();
      state.searchIndex = (state.searchIndex - 1 + state.searchMatches.length) % state.searchMatches.length;
      updateSearchSelection();
    } else if (event.key === "Enter" && state.searchMatches.length) {
      event.preventDefault();
      const index = state.searchIndex >= 0 ? state.searchIndex : 0;
      chooseSearchResult(state.searchMatches[index].id);
    } else if (event.key === "Escape") {
      elements.searchResults.hidden = true;
      elements.searchInput.setAttribute("aria-expanded", "false");
    }
  });

  elements.zoomIn.addEventListener("click", () => {
    const rect = elements.stage.getBoundingClientRect();
    zoomAt(1.24, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  elements.zoomOut.addEventListener("click", () => {
    const rect = elements.stage.getBoundingClientRect();
    zoomAt(0.8, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  elements.fitTree.addEventListener("click", fitTree);
  elements.resetTree.addEventListener("click", () => {
    state.isolatedRootId = null;
    state.collapsed.clear();
    state.generationLimit = Math.min(12, state.maxGeneration);
    elements.generationRange.value = String(state.generationLimit);
    elements.generationOutput.value = String(state.generationLimit);
    selectPerson(state.data.meta.rootPersonId, { openPanel: false });
    closePersonPanel();
    renderTree({ fit: true });
  });
  elements.restoreFullTree.addEventListener("click", () => {
    state.isolatedRootId = null;
    renderTree({ fit: true });
  });
  elements.closePersonPanel.addEventListener("click", closePersonPanel);

  elements.openReviewDialog.addEventListener("click", () => elements.reviewDialog.showModal());
  elements.closeReviewDialog.addEventListener("click", () => elements.reviewDialog.close());
  elements.reviewDialog.addEventListener("click", (event) => {
    if (event.target === elements.reviewDialog) elements.reviewDialog.close();
  });

  elements.stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomAt(event.deltaY < 0 ? 1.12 : 0.89, event.clientX, event.clientY);
  }, { passive: false });

  elements.stage.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.(".person-node")) return;
    elements.stage.setPointerCapture(event.pointerId);
    state.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.activePointers.size === 1) {
      state.panStart = { clientX: event.clientX, clientY: event.clientY, x: state.view.x, y: state.view.y };
      elements.stage.classList.add("is-panning");
    } else if (state.activePointers.size === 2) {
      const points = [...state.activePointers.values()];
      const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const rect = elements.stage.getBoundingClientRect();
      state.pinchStart = {
        distance,
        scale: state.view.scale,
        worldX: (midpoint.x - rect.left - state.view.x) / state.view.scale,
        worldY: (midpoint.y - rect.top - state.view.y) / state.view.scale,
      };
    }
  });

  elements.stage.addEventListener("pointermove", (event) => {
    if (!state.activePointers.has(event.pointerId)) return;
    state.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.activePointers.size === 2 && state.pinchStart) {
      const points = [...state.activePointers.values()];
      const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const rect = elements.stage.getBoundingClientRect();
      const scale = clamp(state.pinchStart.scale * distance / state.pinchStart.distance, 0.025, 2.4);
      state.view.scale = scale;
      state.view.x = midpoint.x - rect.left - state.pinchStart.worldX * scale;
      state.view.y = midpoint.y - rect.top - state.pinchStart.worldY * scale;
      applyViewTransform();
    } else if (state.activePointers.size === 1 && state.panStart) {
      state.view.x = state.panStart.x + event.clientX - state.panStart.clientX;
      state.view.y = state.panStart.y + event.clientY - state.panStart.clientY;
      applyViewTransform();
    }
  });

  function releasePointer(event) {
    state.activePointers.delete(event.pointerId);
    if (state.activePointers.size === 1) {
      const [point] = state.activePointers.values();
      state.panStart = { clientX: point.x, clientY: point.y, x: state.view.x, y: state.view.y };
    } else {
      state.panStart = null;
      state.pinchStart = null;
      elements.stage.classList.remove("is-panning");
    }
  }

  elements.stage.addEventListener("pointerup", releasePointer);
  elements.stage.addEventListener("pointercancel", releasePointer);
  elements.stage.addEventListener("click", (event) => {
    if (!event.target.closest?.(".person-node")) {
      elements.searchResults.hidden = true;
      elements.searchInput.setAttribute("aria-expanded", "false");
    }
  });

  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(fitTree);
  });
}

async function initialize() {
  try {
    const data = await loadTreeData();
    buildIndexes(data);
    updateSummary();
    renderReviewDialog();
    initializeInteractions();
    renderTree({ fit: true });
    elements.loading.hidden = true;
  } catch (error) {
    console.error(error);
    elements.loading.hidden = true;
    elements.error.hidden = false;
  }
}

initialize();
