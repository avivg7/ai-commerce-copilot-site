// Real plugin-admin labels that the site's UI replicas (dashboard preview, rules demo, merchant view, Ask Reco panel) show in ENGLISH on es/ru pages, because the AICC
// admin itself is English (and Hebrew) only: a merchant must find exactly these words in their WordPress admin. On he pages the replicas use the plugin's own Hebrew labels.
// Source of truth: brand/content/replica-labels.json (shared with the Control Plane). The translation checkers treat them like brand names (never "untranslated English").
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./load.mjs";

const SRC = JSON.parse(fs.readFileSync(path.join(ROOT, "brand/content/replica-labels.json"), "utf8"));
export const REPLICA_LABELS = [...SRC.labels].sort((a, b) => b.length - a.length);
export const HE_ADMIN_LABELS = SRC.he;
