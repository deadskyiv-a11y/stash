import sharp from "sharp";
import { fetchImage, fetchPage, type Page } from "./fetch-page";
import { read, type Reading } from "./ai";
import { embed, type Authed } from "./server";
import { SAVE_COLUMNS, type Save } from "./types";

export type NewSave =
  | { kind: "link"; url: string; image?: string }
  | { kind: "note"; text: string; url?: string; from?: string } // url and from: a quote, and the page it was taken from
  | { kind: "image"; path: string; name?: string }
  | { kind: "file"; path: string; name?: string; cover?: string };

type Picture = { path: string; w: number; h: number; pale: boolean; forAi: Buffer };

/** Shrinks an image, stores it, and works out whether it is pale enough to need an edge on white. */
async function storePicture(a: Authed, id: string, raw: Buffer, maxWidth: number): Promise<Picture | null> {
  try {
    const base = sharp(raw, { failOn: "none", animated: false }).rotate();
    const out = await base
      .clone()
      .resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    if (out.info.width < 40 || out.info.height < 40) return null;

    const tiny = await base.clone().resize(24, 24, { fit: "fill" }).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer();
    let sum = 0;
    let n = 0;
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        if (x > 1 && x < 22 && y > 1 && y < 22) continue;
        const i = (y * 24 + x) * 3;
        sum += 0.2126 * tiny[i] + 0.7152 * tiny[i + 1] + 0.0722 * tiny[i + 2];
        n++;
      }
    }
    const forAi = await base.clone().resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();

    const path = `${a.userId}/${id}.webp`;
    const { error } = await a.db.storage.from("saves").upload(path, out.data, { contentType: "image/webp", upsert: true });
    if (error) return null;
    return { path, w: out.info.width, h: out.info.height, pale: sum / n > 236, forAi };
  } catch (e) {
    console.error("Image processing failed", e);
    return null;
  }
}

async function existingGroups(a: Authed) {
  const { data } = await a.db.from("saves").select("cluster,subgroup").not("cluster", "is", null).limit(3000);
  const map = new Map<string, Set<string>>();
  for (const r of data || []) {
    if (!r.cluster || r.cluster === "Inbox") continue;
    if (!map.has(r.cluster)) map.set(r.cluster, new Set());
    if (r.subgroup) map.get(r.cluster)!.add(r.subgroup);
  }
  return [...map.entries()].map(([cluster, s]) => ({ cluster, subgroups: [...s] }));
}

/** Gives an existing save the picture Kofi supplied, for links whose site would not hand one over. */
export async function setPicture(a: Authed, id: string, uploadPath: string): Promise<Save> {
  const { data: file } = await a.db.storage.from("saves").download(uploadPath);
  if (!file) throw new Error("Could not read the picture");
  const picture = await storePicture(a, id, Buffer.from(await file.arrayBuffer()), 1600);
  await a.db.storage.from("saves").remove([uploadPath]);
  if (!picture) throw new Error("Could not use that picture");

  // Read the save again with the screenshot, so the title, filing and search reflect what it shows.
  const { data: row } = await a.db.from("saves").select("url,site,title,summary,content,tags,cluster,subgroup,pinned").eq("id", id).single();
  const text = row?.content || "";
  const reading = await read({
    kind: "link", url: row?.url ?? null, site: row?.site ?? null, title: row?.title ?? null, description: row?.summary ?? null,
    text, image: { data: picture.forAi, mediaType: "image/jpeg" }, existing: await existingGroups(a),
  });
  const update: Record<string, unknown> = { image_path: picture.path, image_w: picture.w, image_h: picture.h, is_pale: picture.pale };
  if (reading) {
    const tags = reading.tags || [];
    const searchText = [reading.title, reading.summary, tags.join(" "), reading.cluster, reading.subgroup, row?.site,
      (reading.facts || []).map((f) => `${f.label} ${f.value}`).join(" "), "link"].filter(Boolean).join(" ");
    const embedding = await embed(a, [reading.title, reading.summary, tags.join(", "), reading.cluster, reading.subgroup, text.slice(0, 1200)].filter(Boolean).join(". "));
    Object.assign(update, {
      title: reading.title || row?.title, summary: reading.summary || row?.summary, tags,
      // Pinned saves stay where Kofi put them.
      ...(row?.pinned ? {} : { cluster: reading.cluster || row?.cluster, subgroup: reading.subgroup || null }),
      facts: reading.facts || [], search_text: searchText,
      ...(embedding ? { embedding: JSON.stringify(embedding) } : {}),
    });
  }
  const { data, error } = await a.db
    .from("saves")
    .update(update)
    .eq("id", id)
    .select(SAVE_COLUMNS)
    .single();
  if (error || !data) throw new Error(error?.message || "Could not update the save");
  return data as unknown as Save;
}

export async function createSave(a: Authed, input: NewSave): Promise<Save> {
  const first: Record<string, string | null> =
    input.kind === "link" ? { kind: "link", url: input.url }
    : input.kind === "note" ? { kind: "note", note: input.text, url: input.url || null }
    : { kind: input.kind, title: input.name || null };
  const { data: row, error } = await a.db.from("saves").insert(first).select("id").single();
  if (error || !row) throw new Error(error?.message || "Could not save");
  const id: string = row.id;

  try {
    let page: Page | null = null;
    let picture: Picture | null = null;
    let text = "";
    let filePath: string | null = null;
    let pdf: Buffer | null = null;

    if (input.kind === "file") {
      const { data: file } = await a.db.storage.from("saves").download(input.path);
      const buf = file ? Buffer.from(await file.arrayBuffer()) : null;
      if (!buf || buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
        await a.db.storage.from("saves").remove([input.path]);
        throw new Error("Only PDF documents can be saved for now.");
      }
      const to = `${a.userId}/${id}.pdf`;
      const { error: mv } = await a.db.storage.from("saves").move(input.path, to);
      filePath = mv ? input.path : to;
      // ponytail: the AI reads the PDF itself, up to 15 MB. No text is extracted for search beyond its summary and facts; add a text extractor if answers need the full wording.
      if (buf.length <= 15 * 1024 * 1024) pdf = buf;
      // The browser drew the first page and uploaded it. Keep it as the tile picture.
      if (input.cover) {
        const { data: c } = await a.db.storage.from("saves").download(input.cover);
        if (c) picture = await storePicture(a, id, Buffer.from(await c.arrayBuffer()), 900);
        await a.db.storage.from("saves").remove([input.cover]);
      }
    } else if (input.kind === "link") {
      try {
        page = await fetchPage(input.url);
        text = page.text;
        if (page.imageUrl) {
          const raw = await fetchImage(page.imageUrl);
          if (raw) picture = await storePicture(a, id, raw, 900);
        }
      } catch (e) {
        console.error("Page fetch failed", e);
      }
      // The browser button passes the picture Kofi's own browser saw, for sites that hide it from servers.
      if (!picture && input.image) {
        const raw = await fetchImage(input.image);
        if (raw) picture = await storePicture(a, id, raw, 900);
      }
    } else if (input.kind === "image") {
      const { data: file } = await a.db.storage.from("saves").download(input.path);
      if (file) {
        picture = await storePicture(a, id, Buffer.from(await file.arrayBuffer()), 1600);
        if (picture && picture.path !== input.path) await a.db.storage.from("saves").remove([input.path]);
      }
    } else {
      text = input.text;
    }

    const source = input.kind === "link" ? input.url : input.kind === "note" ? input.url || null : null;
    const host = source ? new URL(source).hostname.replace(/^www\./, "") : null;
    const reading: Reading | null = await read({
      kind: input.kind,
      url: page?.url || source,
      site: page?.site || host,
      title: page?.title || (input.kind === "image" || input.kind === "file" ? input.name : input.kind === "note" && input.from ? `Quote from: ${input.from}` : null),
      description: page?.description,
      text,
      image: picture ? { data: picture.forAi, mediaType: "image/jpeg" } : null,
      pdf,
      existing: await existingGroups(a),
    });

    const title =
      reading?.title || page?.title?.slice(0, 140) ||
      (input.kind === "note" ? input.text.split("\n")[0].slice(0, 80) : input.kind === "image" ? input.name || "Image" : input.kind === "file" ? input.name || "Document" : host) ||
      "Untitled";
    const summary = reading?.summary || page?.description || null;
    const tags = reading?.tags || [];
    const cluster = reading?.cluster || "Unsorted";
    const subgroup = reading?.subgroup || null;
    const site = page?.site || host;
    const searchText = [title, summary, input.kind === "note" ? input.text : "", tags.join(" "), cluster, subgroup, site,
      (reading?.facts || []).map((f) => `${f.label} ${f.value}`).join(" "), input.kind === "file" ? "pdf document file" : input.kind].filter(Boolean).join(" ");
    const embedding = await embed(a, [title, summary, tags.join(", "), cluster, subgroup, text.slice(0, 1200)].filter(Boolean).join(". "));

    const { data: done, error: upErr } = await a.db
      .from("saves")
      .update({
        status: "ready",
        url: page?.url || source,
        site, title, summary, tags, cluster, subgroup,
        facts: reading?.facts || [],
        image_path: picture?.path || null,
        file_path: filePath,
        image_w: picture?.w || null,
        image_h: picture?.h || null,
        is_pale: picture?.pale || false,
        content: text ? text.slice(0, 6000) : null,
        search_text: searchText,
        embedding: embedding ? JSON.stringify(embedding) : null,
      })
      .eq("id", id)
      .select(SAVE_COLUMNS)
      .single();
    if (upErr || !done) throw new Error(upErr?.message || "Could not finish the save");
    return done as unknown as Save;
  } catch (e) {
    await a.db.from("saves").update({ status: "failed", cluster: "Unsorted" }).eq("id", id);
    throw e;
  }
}
