import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const CHAPTER_DIR = path.join(ROOT_DIR, "data", "chapters");
const OUTPUT_PATH = path.join(ROOT_DIR, "data", "family-tree.json");
const AUDIT_PATH = path.join(ROOT_DIR, "data", "family-tree-audit.json");
const SCRIPT_OUTPUT_PATH = path.join(ROOT_DIR, "data", "family-tree-data.js");

const site = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "data", "site.json"), "utf8"));
const chapterIndex = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "data", "chapters.json"), "utf8"));
const chapters = new Map(
  chapterIndex.map((chapter) => [
    chapter.id,
    {
      ...chapter,
      data: JSON.parse(
        fs.readFileSync(path.join(ROOT_DIR, chapter.dataFile.replace(/^\.\//, "")), "utf8"),
      ),
    },
  ]),
);

const people = [];
const links = [];
const issues = [];
const sourceRecords = [];
const nameIndex = new Map();
const pendingAdoptions = [];
let nextPersonId = 1;
let nextSourceId = 1;
let nextIssueId = 1;

const numberMap = new Map([
  ["一", 1], ["二", 2], ["两", 2], ["三", 3], ["四", 4], ["五", 5],
  ["六", 6], ["七", 7], ["八", 8], ["九", 9], ["十", 10],
]);

const ignoredNameTokens = new Set([
  "一个", "其他", "分别", "具体", "不详", "早逝", "无嗣", "均无", "大学", "本科",
  "专科", "中专", "老师", "女儿", "子女", "其子", "三子妹", "四个女", "五个女",
]);

const subjectOverrides = new Map([
  ["08:肇鹏", "肇朋"],
  ["32:启华", "启铧"],
]);

const deferredParentSubjects = new Set(["22:延胜"]);

function readChapter(id) {
  const chapter = chapters.get(id);
  if (!chapter) {
    throw new Error(`Missing chapter ${id}`);
  }
  return chapter;
}

function cleanName(value) {
  return String(value ?? "")
    .replace(/[\s　]+/gu, "")
    .replace(/^[→—–-]+/u, "")
    .replace(/[，,。；;：:、]+$/u, "")
    .replace(/[（(].*?[）)]/gu, "")
    .replace(/(?:太)?公$/u, "")
    .trim();
}

function indexName(name, person) {
  const key = cleanName(name);
  if (!key) return;
  const list = nameIndex.get(key) ?? [];
  if (!list.includes(person)) list.push(person);
  nameIndex.set(key, list);
}

function createPerson(name, options = {}) {
  const canonicalName = cleanName(name) || "姓名未载";
  const person = {
    id: `p${String(nextPersonId).padStart(4, "0")}`,
    name: canonicalName,
    aliases: [],
    gender: options.gender ?? "unknown",
    generation: Number.isInteger(options.generation) ? options.generation : null,
    spouses: [],
    statuses: [],
    unnamedChildren: { male: 0, female: 0, unknown: 0 },
    sources: [],
    notes: [],
    confidence: options.confidence ?? "confirmed",
    synthetic: Boolean(options.synthetic),
  };
  nextPersonId += 1;
  people.push(person);
  indexName(canonicalName, person);
  return person;
}

function addAlias(person, alias) {
  const value = cleanName(alias);
  if (!value || value === person.name || person.aliases.includes(value)) return;
  person.aliases.push(value);
  indexName(value, person);
}

function addUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function addSourceToPerson(person, source) {
  if (source && !person.sources.includes(source.id)) person.sources.push(source.id);
}

function addIssue(type, message, options = {}) {
  const issue = {
    id: `i${String(nextIssueId).padStart(3, "0")}`,
    type,
    severity: options.severity ?? "review",
    message,
    chapterId: options.source?.chapterId ?? options.chapterId ?? null,
    page: options.source?.page ?? options.page ?? null,
    sourceId: options.source?.id ?? null,
    personIds: (options.people ?? []).map((person) => person.id),
  };
  nextIssueId += 1;
  issues.push(issue);
  for (const person of options.people ?? []) {
    if (person.confidence === "confirmed") person.confidence = "review";
  }
  return issue;
}

function createSource(chapter, section, index, text, metadata = {}) {
  const source = {
    id: `s${String(nextSourceId).padStart(4, "0")}`,
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    page: chapter.originalPage,
    section,
    index,
    level: metadata.level ?? null,
    marker: metadata.marker ?? "",
    kind: metadata.kind ?? "",
    text: String(text ?? "").trim(),
    resolvedPersonIds: [],
  };
  nextSourceId += 1;
  sourceRecords.push(source);
  return source;
}

function incomingLinks(person, types = ["parent-child", "context"]) {
  return links.filter((link) => link.to === person.id && types.includes(link.type));
}

function outgoingChildren(person) {
  return links
    .filter((link) => link.from === person.id && link.type === "parent-child")
    .map((link) => people.find((candidate) => candidate.id === link.to));
}

function findChild(parent, name) {
  const target = cleanName(name);
  return outgoingChildren(parent).find(
    (child) => child && (child.name === target || child.aliases.includes(target)),
  );
}

function addLink(from, to, type, options = {}) {
  if (!from || !to || from.id === to.id) return null;
  const existing = links.find(
    (link) => link.from === from.id && link.to === to.id && link.type === type,
  );
  if (existing) {
    if (options.source && !existing.sources.includes(options.source.id)) {
      existing.sources.push(options.source.id);
    }
    if (existing.confidence === "confirmed" && options.confidence === "review") {
      existing.confidence = "review";
    }
    return existing;
  }
  const link = {
    from: from.id,
    to: to.id,
    type,
    confidence: options.confidence ?? "confirmed",
    label: options.label ?? "",
    sources: options.source ? [options.source.id] : [],
  };
  links.push(link);
  return link;
}

function createChild(parent, name, gender, source, options = {}) {
  const normalized = cleanName(name);
  if (!normalized) return null;
  let child = normalized === "××" || normalized === "姓名未载"
    ? null
    : findChild(parent, normalized);
  if (!child && options.existing && incomingLinks(options.existing, ["parent-child"]).length === 0) {
    child = options.existing;
  }
  if (!child) {
    child = createPerson(normalized, {
      gender,
      generation: Number.isInteger(parent.generation) ? parent.generation + 1 : null,
      confidence: options.confidence,
    });
  } else if (child.gender === "unknown" && gender !== "unknown") {
    child.gender = gender;
  }
  addSourceToPerson(child, source);
  addLink(parent, child, "parent-child", {
    confidence: options.confidence,
    label: options.label,
    source,
  });
  return child;
}

function chineseNumber(value) {
  if (!value) return null;
  if (/^\d+$/u.test(value)) return Number(value);
  if (numberMap.has(value)) return numberMap.get(value);
  if (value.startsWith("十")) return 10 + (numberMap.get(value.slice(1)) ?? 0);
  if (value.endsWith("十")) return (numberMap.get(value.slice(0, -1)) ?? 1) * 10;
  const [tens, ones] = value.split("十");
  if (ones !== undefined) return (numberMap.get(tens) ?? 1) * 10 + (numberMap.get(ones) ?? 0);
  return null;
}

function addResolvedSource(source, person) {
  if (!source.resolvedPersonIds.includes(person.id)) source.resolvedPersonIds.push(person.id);
  addSourceToPerson(person, source);
}

function seedMainLine() {
  const chapter = readChapter("05");
  const paragraphs = chapter.data.content;
  const sources = paragraphs.map((text, index) => createSource(chapter, "content", index + 1, text));
  const generations = [
    ["永宣", 1], ["检教", 2], ["朝亮", 3], ["宗光", 4], ["宗深", 4], ["宗耀", 4],
    ["法安", 5], ["法尧", 5], ["法兆", 5], ["甘朋", 6], ["际亨", 7], ["际章", 7],
    ["保志", 8], ["庆珍", 9], ["庆求", 9], ["道举", 10], ["道圣", 10], ["道显", 10],
  ];
  const seeded = new Map(generations.map(([name, generation]) => [name, createPerson(name, { generation, gender: "male" })]));
  const relations = [
    ["永宣", "检教", sources[1]], ["检教", "朝亮", sources[1]],
    ["朝亮", "宗光", sources[1]], ["朝亮", "宗深", sources[1]], ["朝亮", "宗耀", sources[1]],
    ["宗深", "法安", sources[2]], ["宗深", "法尧", sources[2]], ["宗深", "法兆", sources[2]],
    ["法兆", "甘朋", sources[3]], ["甘朋", "际亨", sources[3]], ["甘朋", "际章", sources[3]],
    ["际亨", "保志", sources[5]], ["保志", "庆珍", sources[6]], ["保志", "庆求", sources[6]],
    ["庆求", "道举", sources[7]], ["庆求", "道圣", sources[7]], ["庆求", "道显", sources[7]],
  ];
  for (const [parentName, childName, source] of relations) {
    const parent = seeded.get(parentName);
    const child = seeded.get(childName);
    addSourceToPerson(parent, source);
    addSourceToPerson(child, source);
    addResolvedSource(source, parent);
    addResolvedSource(source, child);
    addLink(parent, child, "parent-child", { source });
  }
  addResolvedSource(sources[0], seeded.get("永宣"));
  addResolvedSource(sources[4], seeded.get("际亨"));
  addResolvedSource(sources[4], seeded.get("甘朋"));
  addUnique(seeded.get("宗光").statuses, "留住岑溪");
  addUnique(seeded.get("宗耀").statuses, "去向不明");
  addUnique(seeded.get("法安").statuses, "迁往广东高州");
  addUnique(seeded.get("法尧").statuses, "迁往容县、北流");
  addUnique(seeded.get("法兆").statuses, "迁往藤县");
  addUnique(seeded.get("际章").statuses, "迁往平南六陈");
  addUnique(seeded.get("庆珍").statuses, "去向不明");
  addUnique(seeded.get("道举").statuses, "去向不明");
  addAlias(seeded.get("法尧"), "法宽");
  addIssue(
    "source-conflict",
    "宗深公次子在第5章记为“法尧”，第1章迁徙图记为“法宽”；页面保留两种原文写法，待原谱核定。",
    { chapterId: "01", page: 3, people: [seeded.get("法尧")] },
  );
  return seeded;
}

const seeded = seedMainLine();

function candidatesFor(name) {
  return nameIndex.get(cleanName(name)) ?? [];
}

function isDescendantOf(person, ancestor) {
  const visited = new Set();
  const queue = [person.id];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    for (const link of links.filter((item) => item.to === id && item.type === "parent-child")) {
      if (link.from === ancestor.id) return true;
      queue.push(link.from);
    }
  }
  return false;
}

function registerLocal(context, person) {
  for (const name of [person.name, ...person.aliases]) {
    const key = cleanName(name);
    if (key) context.local.set(key, person);
  }
}

function resolvePerson(rawName, context, source, parentHint = null) {
  let name = cleanName(rawName);
  if (!name) return null;
  const override = subjectOverrides.get(`${context.chapter.id}:${name}`);
  if (override) {
    const target = candidatesFor(override)[0] ?? createPerson(override);
    addAlias(target, name);
    addIssue(
      "source-variant",
      `第${context.chapter.id}章使用“${name}”，与前文“${override}”疑为同一人；已合并展示并保留异写。`,
      { source, people: [target] },
    );
    name = override;
    registerLocal(context, target);
    return target;
  }
  if (context.local.has(name)) return context.local.get(name);
  if (deferredParentSubjects.has(`${context.chapter.id}:${name}`)) {
    const deferred = createPerson(name, { confidence: "review" });
    registerLocal(context, deferred);
    return deferred;
  }
  const candidates = candidatesFor(name);
  if (parentHint) {
    const matchingChild = candidates.find((candidate) =>
      links.some((link) => link.from === parentHint.id && link.to === candidate.id && link.type === "parent-child"),
    );
    if (matchingChild) {
      registerLocal(context, matchingChild);
      return matchingChild;
    }
    const descendantMatch = candidates.find((candidate) => isDescendantOf(candidate, parentHint));
    if (descendantMatch) {
      registerLocal(context, descendantMatch);
      return descendantMatch;
    }
    if (candidates.length) {
      const person = createPerson(name, {
        generation: parentHint.generation != null ? parentHint.generation + 1 : null,
        confidence: "review",
      });
      registerLocal(context, person);
      addLink(parentHint, person, "parent-child", {
        confidence: "review",
        label: "依原文层级暂接",
        source,
      });
      addIssue(
        "layout-inference",
        `“${name}”与其他支系存在同名记录，且未出现在“${parentHint.name}”的子女名单中；现按本章层级另建人物。`,
        { source, people: [parentHint, person] },
      );
      return person;
    }
  }
  if (candidates.length === 1) {
    registerLocal(context, candidates[0]);
    return candidates[0];
  }
  if (candidates.length > 1 && context.branchRoot) {
    const branchMatch = candidates.find((candidate) => isDescendantOf(candidate, context.branchRoot));
    if (branchMatch) {
      registerLocal(context, branchMatch);
      return branchMatch;
    }
  }
  const person = createPerson(name, {
    generation: parentHint?.generation != null ? parentHint.generation + 1 : null,
    confidence: parentHint ? "review" : "unlinked",
  });
  registerLocal(context, person);
  if (parentHint) {
    addLink(parentHint, person, "parent-child", { confidence: "review", label: "依原文层级暂接", source });
    addIssue(
      "layout-inference",
      `“${name}”未出现在上代的子女名单中，现依章节层级暂接在“${parentHint.name}”名下。`,
      { source, people: [parentHint, person] },
    );
  } else {
    addIssue(
      "unlinked-branch",
      `“${name}”在现有资料中没有可确定的上代衔接。`,
      { source, people: [person] },
    );
  }
  return person;
}

function stripEntryPrefix(text) {
  return String(text)
    .trim()
    .replace(/^入岑第\d+(?:代|世祖)\s*/u, "")
    .replace(/^(?:长|次|三|四)(?:房)?(?:\s*[：:]\s*|[\s　]+)/u, "")
    .replace(/^[一二三四五六七八九十]+、\s*/u, "")
    .replace(/^[①②③④⑤⑥⑦⑧⑨⑩]、?\s*/u, "")
    .trim();
}

function knownPrefix(text, context) {
  const names = new Set([...context.local.keys(), ...nameIndex.keys()]);
  return [...names]
    .filter((name) => text.startsWith(name) || text.startsWith(`${name}公`))
    .sort((a, b) => b.length - a.length)[0] ?? "";
}

function extractLeadingName(text, context) {
  const value = stripEntryPrefix(text);
  if (/^(?:葬于|坐|享年|广西|本科|大学|大专|中专|专科|曾任|在|于|住|其他|俗称|均|再娶|娶|生于|逝于|一个|他|她)/u.test(value)) {
    return "";
  }
  const known = knownPrefix(value, context);
  if (known) return known;
  const colonOnly = value.match(/^([\p{Script=Han}×]{1,5})(?=[：:]\s*$)/u);
  if (colonOnly) return cleanName(colonOnly[1]);
  if (
    /^(?:[\p{Script=Han}]{2,5}|××)$/u.test(value)
    && !/(?:娶|嫁|生|育|无嗣|无育|早逝)/u.test(value)
    && !ignoredNameTokens.has(value)
  ) {
    return cleanName(value);
  }
  const match = value.match(
    /^(.+?)(?=(?:公)?(?:娶|嫁|生|育|无嗣|无育|早逝|去|在|参加|就读|本科|大专|中专|专科|大学|当|任|又名|曾用名|给|号|，|,|。|；|;|\s|\d))/u,
  );
  const candidate = cleanName(match?.[1] ?? "");
  return /^(?:[\p{Script=Han}]{2,5}|××)$/u.test(candidate) && !ignoredNameTokens.has(candidate)
    ? candidate
    : "";
}

function parentHint(context, level) {
  if (!Number.isInteger(level) || level <= 0) return null;
  for (let cursor = level - 1; cursor >= 0; cursor -= 1) {
    if (context.stack[cursor]) return context.stack[cursor];
  }
  return context.branchRoot ?? null;
}

function addSpouses(person, sentence) {
  const pattern = /(再娶|娶|嫁)(.+?)(?=(?:生|育|[一二三四五六七八九十两\d]+(?:个)?(?:子|女)|无嗣|无育|早逝|，|,|。|；|;|$))/gu;
  const firstChildMarker = childMarkers(sentence)[0];
  let recordedMarriage = false;
  for (const match of sentence.matchAll(pattern)) {
    const relation = match[1];
    if (firstChildMarker && match.index > firstChildMarker.start && relation !== "再娶") continue;
    if (relation === "嫁" && recordedMarriage) continue;
    const values = match[2]
      .split(/[、]/u)
      .map((value) => value
        .replace(/^[于到往]/u, "")
        .split(/(?:本科|大专|中专|专科|大学|广西|就读|在深圳|在南宁|当老师|任职|工作)/u)[0]
      .trim())
      .filter((value) => value && value.length <= 10 && !/^(?:外地|南洋|广东|容县|苍梧)$/u.test(value));
    const relationValues = relation === "嫁" ? values.slice(0, 1) : values;
    for (const value of relationValues) {
      addUnique(person.spouses, `${relation}${value}`);
      recordedMarriage = true;
    }
  }
}

function addAliasesAndStatuses(person, sentence) {
  const aliasPatterns = [
    /(?:又名|曾用名|改名)(?:为)?([\p{Script=Han}×]{1,5}?)(?=娶|嫁|生|育|，|,|。|；|;|\s|$)/gu,
    /(?:^|[，,。；;\s])(?:字|号)(?:为)?([\p{Script=Han}×]{1,5}?)(?=娶|嫁|生|育|，|,|。|；|;|\s|$)/gu,
  ];
  for (const pattern of aliasPatterns) {
    for (const match of sentence.matchAll(pattern)) {
      addAlias(person, match[1]);
    }
  }
  const statusPatterns = [
    [/(?:无嗣|无育)/u, "无嗣"],
    [/早逝/u, "早逝"],
    [/去向不明|去向不详/u, "去向不明"],
    [/具体不详|子女不详/u, "资料不详"],
    [/移居南洋|去南洋|均住南洋/u, "迁居南洋"],
  ];
  for (const [pattern, label] of statusPatterns) {
    if (pattern.test(sentence)) addUnique(person.statuses, label);
  }
}

function normalizeChildToken(value) {
  const original = value.trim();
  if (/^(?:重庆|广西|桂林|南宁|梧州|岑溪|大学|本科|大专|中专|专科)/u.test(original)) return "";
  let token = value
    .trim()
    .replace(/^[→：:；;。]+/u, "")
    .replace(/^(?:和|及|一个|长女|次女|大女|二女|三女|四女)/u, "")
    .replace(/[（(].*?[）)]/gu, "")
    .trim();
  token = token.split(/(?:嫁|娶|早逝|去往|去向|入住|居住|住|就读|本科|大学|大专|中专|专科|任职|参加|改名|又名|曾用名|具体|不详|不明|不知|无嗣|无育|均|分别|其他|其子女)/u)[0].trim();
  token = token.replace(/(?:均)?迁.*$/u, "").replace(/读.*$/u, "").trim();
  if (!token || ignoredNameTokens.has(token)) return "";
  if (!/^(?:[\p{Script=Han}]{2,5}|××)$/u.test(token)) return "";
  return cleanName(token);
}

function parseChildNames(payload) {
  const normalized = payload.replace(/^[：:→，,\s　]+/u, "");
  if (/^(?:分别嫁|分别迁|均嫁)/u.test(normalized)) return [];
  return normalized
    .split(/[、，,]/u)
    .map(normalizeChildToken)
    .filter(Boolean);
}

function childMarkers(sentence) {
  const markers = [];
  const pattern = /(?:(生|育)\s*([一二三四五六七八九十两\d]+)?(?:个)?(子|女)|([一二三四五六七八九十两\d]+)(?:个)?(子|女)|(?:生|育)\s*(女))(?!妹)\s*[：:]?/gu;
  for (const match of sentence.matchAll(pattern)) {
    const genderWord = match[3] ?? match[5] ?? match[6];
    markers.push({
      start: match.index,
      end: match.index + match[0].length,
      count: chineseNumber(match[2] ?? match[4]),
      gender: genderWord === "子" ? "male" : "female",
      text: match[0],
    });
  }
  return markers;
}

function parseChildren(person, sentence, source, context) {
  const markers = childMarkers(sentence);
  const created = [];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const end = markers[index + 1]?.start ?? sentence.length;
    const payload = sentence.slice(marker.end, end);
    const names = parseChildNames(payload);
    const spouseNames = person.spouses.map((spouse) => spouse.replace(/^(?:再娶|娶|嫁)/u, ""));
    const uniqueNames = [...new Set(names)].filter((name) => !spouseNames.includes(name));
    const acceptedNames = marker.count != null
      ? uniqueNames.slice(0, marker.count)
      : uniqueNames;
    for (const name of acceptedNames) {
      const child = createChild(person, name, marker.gender, source, {
        existing: context.local.get(name),
      });
      if (child) {
        registerLocal(context, child);
        created.push(child);
      }
    }
    if (marker.count != null && marker.count > acceptedNames.length) {
      const missing = marker.count - acceptedNames.length;
      const bucket = marker.gender === "male" ? "male" : "female";
      person.unnamedChildren[bucket] += missing;
    }
    if (marker.count != null && uniqueNames.length > marker.count) {
      addIssue(
        "child-count-conflict",
        `“${person.name}”原文记${marker.text.replace(/[：:]$/u, "")}，但同句识别到${uniqueNames.length}个姓名。`,
        { source, people: [person] },
      );
    }
  }
  if (!markers.length) {
    const directList = sentence.match(/(?<!一)(?:生|育)\s*→?\s*((?:[\p{Script=Han}×]{2,5})(?:、[\p{Script=Han}×]{2,5})+)/u);
    if (directList) {
      for (const name of directList[1].split("、")) {
        const child = createChild(person, name, "unknown", source, {
          existing: context.local.get(cleanName(name)),
        });
        if (child) {
          registerLocal(context, child);
          created.push(child);
        }
      }
    } else {
      const direct = sentence.match(/(?<!一)(?:生|育)\s*→?\s*([\p{Script=Han}×]{2,5})(?=[，,。；;]|$)/u);
      if (direct) {
        const child = createChild(person, direct[1], "unknown", source, {
          existing: context.local.get(cleanName(direct[1])),
        });
        if (child) {
          registerLocal(context, child);
          created.push(child);
        }
      }
    }
  }
  return created;
}

function parseAdoption(person, sentence, source, context) {
  for (const match of sentence.matchAll(/[，,](?:继|过继)([\p{Script=Han}×]{2,5})/gu)) {
    pendingAdoptions.push({ from: person, targetName: cleanName(match[1]), source, context });
  }
}

function splitKnownClauses(text, context) {
  const normalized = text
    .replace(/甘飞、甘云。甘亮。/gu, "甘飞、甘云、甘亮。")
    .replace(/([\p{Script=Han}×]{1,5})→(?=生|育)/gu, "$1。$1");
  const pieces = normalized.split(/[。；;]/u).map((value) => value.trim()).filter(Boolean);
  const result = [];
  for (const piece of pieces) {
    let cursor = 0;
    const breakpoints = [];
    for (const match of piece.matchAll(/，([\p{Script=Han}×]{2,4})(?:公)?(?=娶|生|育)/gu)) {
      const name = cleanName(match[1]);
      if (!/^(?:号|再)/u.test(name) && !/(?:大学|本科|专科|中专|毕业|工作)/u.test(name)) {
        breakpoints.push(match.index);
      }
    }
    for (const breakpoint of breakpoints) {
      result.push(piece.slice(cursor, breakpoint).replace(/^，/u, "").trim());
      cursor = breakpoint + 1;
    }
    result.push(piece.slice(cursor).replace(/^，/u, "").trim());
  }
  return result.filter(Boolean);
}

function annotateMentionedPeople(sentence, source, context) {
  if (!/(?:不详|不明|嫁|早逝|无嗣|无育)/u.test(sentence)) return;
  const knownNames = [...new Set([...context.local.keys(), ...nameIndex.keys()])]
    .sort((a, b) => b.length - a.length);
  for (const name of knownNames) {
    if (!sentence.includes(name)) continue;
    const candidate = context.local.get(name) ?? candidatesFor(name)[0];
    if (!candidate) continue;
    addResolvedSource(source, candidate);
    if (new RegExp(`${name}[^。；]{0,8}(?:不详|不明)`, "u").test(sentence)) {
      addUnique(candidate.statuses, "资料不详");
    }
    if (new RegExp(`${name}[^。；]{0,8}早逝`, "u").test(sentence)) addUnique(candidate.statuses, "早逝");
    if (new RegExp(`${name}[^。；]{0,8}(?:无嗣|无育)`, "u").test(sentence)) addUnique(candidate.statuses, "无嗣");
  }
}

function processSource(source, context, metadata = {}) {
  const raw = source.text;
  const continuation = /^(?:[一二三四五六七八九十两\d]+)?(?:个)?女\s*(?:[：:，,]|嫁)/u.test(raw.trim());
  const clauses = splitKnownClauses(raw, context);
  let firstSubject = null;
  let carriedSubject = continuation ? context.lastSubject : null;
  for (const clause of clauses) {
    const hint = parentHint(context, metadata.level);
    const clauseIsContinuation = /^(?:[一二三四五六七八九十两\d]+)?(?:个)?女\s*(?:[：:，,]|嫁)/u.test(clause);
    const leading = (continuation || clauseIsContinuation) && carriedSubject
      ? ""
      : extractLeadingName(clause, context);
    let subject = null;
    if (leading && carriedSubject?.spouses.some((spouse) => {
      const spouseName = spouse.replace(/^(?:再娶|娶|嫁)/u, "");
      return spouseName === leading.replace(/太婆$/u, "");
    })) {
      subject = carriedSubject;
    } else if (
      leading
      && carriedSubject
      && (/姑$/u.test(leading) || clause.includes("嫁"))
      && carriedSubject.unnamedChildren.female > 0
    ) {
      subject = createChild(carriedSubject, leading, "female", source);
      carriedSubject.unnamedChildren.female -= 1;
      registerLocal(context, subject);
    } else {
      subject = leading
        ? resolvePerson(leading, context, source, hint)
        : carriedSubject ?? context.lastSubject;
    }
    if (!subject) {
      annotateMentionedPeople(clause, source, context);
      continue;
    }
    if (!firstSubject) firstSubject = subject;
    carriedSubject = subject;
    context.lastSubject = subject;
    addResolvedSource(source, subject);
    addSpouses(subject, clause);
    addAliasesAndStatuses(subject, clause);
    parseChildren(subject, clause, source, context);
    parseAdoption(subject, clause, source, context);
    annotateMentionedPeople(clause, source, context);
    if (clause.length > 10) addUnique(subject.notes, source.id);
  }
  if (firstSubject && Number.isInteger(metadata.level)) {
    context.stack[metadata.level] = firstSubject;
    context.stack.length = metadata.level + 1;
  }
  if (firstSubject && metadata.kind === "branch") {
    context.branchRoot = firstSubject;
    context.stack = [firstSubject];
  }
}

function processChapter(id) {
  const chapter = readChapter(id);
  const context = {
    chapter,
    local: new Map(),
    stack: [],
    branchRoot: null,
    lastSubject: null,
  };
  for (const person of seeded.values()) registerLocal(context, person);
  const content = Array.isArray(chapter.data.content) ? chapter.data.content : [];
  content.forEach((text, index) => {
    const source = createSource(chapter, "content", index + 1, text);
    processSource(source, context);
  });
  const entries = chapter.data.lineageRecord?.entries ?? [];
  entries.forEach((entry, index) => {
    const source = createSource(chapter, "lineageRecord", index + 1, entry.text, entry);
    processSource(source, context, entry);
  });
}

for (let chapterNumber = 6; chapterNumber <= 35; chapterNumber += 1) {
  processChapter(String(chapterNumber).padStart(2, "0"));
}

function resolvePendingAdoptions() {
  for (const pending of pendingAdoptions) {
    const candidates = candidatesFor(pending.targetName);
    const target = pending.context.local.get(pending.targetName)
      ?? candidates.find((candidate) => candidate.sources.some((sourceId) => {
        const source = sourceRecords.find((record) => record.id === sourceId);
        return source?.chapterId === pending.source.chapterId;
      }))
      ?? candidates[0];
    if (target) {
      addLink(pending.from, target, "adoptive", {
        label: "继嗣／过继",
        source: pending.source,
      });
    } else {
      addIssue(
        "unresolved-adoption",
        `“${pending.from.name}”的继嗣对象“${pending.targetName}”未能与人物记录对应。`,
        { source: pending.source, people: [pending.from] },
      );
    }
  }
}

resolvePendingAdoptions();

function attachContextBranches() {
  const root = seeded.get("道显");
  const contextNode = createPerson("上代衔接待核", {
    synthetic: true,
    confidence: "review",
    generation: 16,
  });
  contextNode.notes.push("第25至35章属于道显公支系，但部分“启”字辈人物在现有资料中缺少明确父子衔接。");
  addLink(root, contextNode, "context", { confidence: "review", label: "支系范围明确，上代关系未载" });
  const candidates = people.filter((person) => {
    if (person.synthetic || person.id === seeded.get("永宣").id) return false;
    if (incomingLinks(person).length) return false;
    const chapterIds = person.sources
      .map((id) => sourceRecords.find((source) => source.id === id)?.chapterId)
      .filter(Boolean);
    return chapterIds.some((chapterId) => Number(chapterId) >= 25);
  });
  for (const person of candidates) {
    addLink(contextNode, person, "context", { confidence: "review", label: "原谱未载直接上代" });
  }
}

attachContextBranches();

function propagateGenerations() {
  const root = seeded.get("永宣");
  const queue = [root];
  const visited = new Set();
  while (queue.length) {
    const person = queue.shift();
    if (visited.has(person.id)) continue;
    visited.add(person.id);
    for (const link of links.filter((item) => item.from === person.id && item.type === "parent-child")) {
      const child = people.find((candidate) => candidate.id === link.to);
      if (!child) continue;
      const expected = person.generation == null ? null : person.generation + 1;
      if (expected != null && child.generation != null && child.generation !== expected) {
        addIssue(
          "generation-conflict",
          `“${child.name}”的世代编号与父辈“${person.name}”不连续。`,
          { people: [person, child] },
        );
      } else if (expected != null) {
        child.generation = expected;
      }
      queue.push(child);
    }
  }
  const inferredPatterns = [
    [/^启/u, 17], [/^以/u, 18], [/初$/u, 19], [/^庆/u, 20], [/昌$/u, 21], [/荣$/u, 22],
  ];
  for (const person of people) {
    if (person.generation != null || person.synthetic) continue;
    if (incomingLinks(person, ["parent-child"]).length) continue;
    const match = inferredPatterns.find(([pattern]) => pattern.test(person.name));
    if (match) person.generation = match[1];
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const link of links.filter((item) => item.type === "parent-child")) {
      const parent = people.find((candidate) => candidate.id === link.from);
      const child = people.find((candidate) => candidate.id === link.to);
      if (parent?.generation != null && child?.generation == null) {
        child.generation = parent.generation + 1;
        changed = true;
      }
    }
  }
}

propagateGenerations();

function flagKnownConflicts() {
  const checks = [
    ["10", "甘斌", "第10章记“甘斌”，而肇奇公子女名单记“甘武”，两者是否同一人待核。"],
    ["12", "甘洋", "第12章后文记“甘洋”，而寿军子女名单记“甘延洋”，两者是否同一人待核。"],
    ["29", "孔娟", "第29章记“孔娟嫁苍梧岭脚黄门”，前文海初女儿名单记“孔媚”，姓名对应待核。"],
  ];
  for (const [chapterId, name, message] of checks) {
    const source = sourceRecords.find((record) => record.chapterId === chapterId && record.text.includes(name));
    const person = candidatesFor(name).find((candidate) => candidate.sources.includes(source?.id));
    addIssue("source-conflict", message, { source, people: person ? [person] : [] });
  }
}

flagKnownConflicts();

function validateGraph() {
  const personIds = new Set(people.map((person) => person.id));
  const incomingParentCounts = new Map();
  for (const link of links) {
    if (!personIds.has(link.from) || !personIds.has(link.to)) {
      throw new Error(`Dangling link ${link.from} -> ${link.to}`);
    }
    if (link.type === "parent-child") {
      incomingParentCounts.set(link.to, (incomingParentCounts.get(link.to) ?? 0) + 1);
      const parent = people.find((person) => person.id === link.from);
      const child = people.find((person) => person.id === link.to);
      if (parent.generation == null || child.generation == null || child.generation !== parent.generation + 1) {
        throw new Error(`Generation mismatch ${parent.name} -> ${child.name}`);
      }
    }
  }
  const multiParent = [...incomingParentCounts.entries()].filter(([, count]) => count > 1);
  if (multiParent.length) throw new Error(`Multiple lineage parents detected for ${multiParent[0][0]}`);
  const unresolvedSources = sourceRecords.filter((source) => !source.resolvedPersonIds.length);
  if (unresolvedSources.length) throw new Error(`Unresolved source record ${unresolvedSources[0].id}`);
  const invalidPerson = people.find((person) =>
    !person.synthetic && (!/^(?:[\p{Script=Han}]{2,5}|××)$/u.test(person.name) || person.generation == null),
  );
  if (invalidPerson) throw new Error(`Invalid person record ${invalidPerson.id}: ${invalidPerson.name}`);
  const adjacency = new Map();
  for (const link of links.filter((item) => item.type === "parent-child")) {
    const list = adjacency.get(link.from) ?? [];
    list.push(link.to);
    adjacency.set(link.from, list);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error(`Cycle detected at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of adjacency.get(id) ?? []) visit(child);
    visiting.delete(id);
    visited.add(id);
  }
  for (const person of people) visit(person.id);
}

validateGraph();

const mainRoot = seeded.get("永宣");
const reachable = new Set([mainRoot.id]);
const queue = [mainRoot.id];
while (queue.length) {
  const id = queue.shift();
  for (const link of links.filter((item) => item.from === id && ["parent-child", "context"].includes(item.type))) {
    if (!reachable.has(link.to)) {
      reachable.add(link.to);
      queue.push(link.to);
    }
  }
}

const unreachableNamed = people.filter((person) => !person.synthetic && !reachable.has(person.id));
if (unreachableNamed.length) {
  throw new Error(`Unreachable person ${unreachableNamed[0].id}: ${unreachableNamed[0].name}`);
}

const unresolvedSources = sourceRecords.filter((source) => !source.resolvedPersonIds.length);
for (const source of unresolvedSources) {
  addIssue("unparsed-source", "该条原文未能可靠归入某一人物，已保留在审计报告。", { source });
}

const standaloneRoots = people.filter(
  (person) => !person.synthetic && person.id !== mainRoot.id && incomingLinks(person).length === 0,
);

const issueCounts = issues.reduce((counts, issue) => {
  counts[issue.type] = (counts[issue.type] ?? 0) + 1;
  return counts;
}, {});

const generationRecord = readChapter("02").data.generationRecord;
const output = {
  meta: {
    title: `${site.lineage}·世系树`,
    sourceEditionDate: site.date,
    sourceEditionDateTime: site.dateTime,
    rootPersonId: mainRoot.id,
    scope: "现有2020年版资料所载世系",
    methodology: "以第5章详细世系为主干，第6至35章逐条抽取；不确定衔接以待核关系保留。",
  },
  generationRecord: generationRecord.generations,
  stats: {
    chapters: chapterIndex.length,
    lineageEntries: chapterIndex.reduce((sum, chapter) => {
      const data = chapters.get(chapter.id).data;
      return sum + (data.lineageRecord?.entries?.length ?? 0);
    }, 0),
    sourceRecords: sourceRecords.length,
    resolvedSourceRecords: sourceRecords.length - unresolvedSources.length,
    people: people.filter((person) => !person.synthetic).length,
    connectedPeople: [...reachable].filter((id) => !people.find((person) => person.id === id)?.synthetic).length,
    links: links.length,
    reviewIssues: issues.length,
    standaloneRoots: standaloneRoots.length,
  },
  people,
  links,
  sources: sourceRecords,
  issues,
};

const audit = {
  meta: output.meta,
  stats: output.stats,
  issueCounts,
  standaloneRoots: standaloneRoots.map((person) => ({
    id: person.id,
    name: person.name,
    sources: person.sources,
  })),
  unresolvedSources,
  issues,
};

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
fs.writeFileSync(AUDIT_PATH, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
fs.writeFileSync(
  SCRIPT_OUTPUT_PATH,
  `window.__FAMILY_TREE_DATA__ = ${JSON.stringify(output)};\n`,
  "utf8",
);

console.log(JSON.stringify({
  output: OUTPUT_PATH,
  audit: AUDIT_PATH,
  browserData: SCRIPT_OUTPUT_PATH,
  stats: output.stats,
  issueCounts,
}, null, 2));
