export type Kind = "link" | "image" | "note" | "file";

/** A recipe written out by the AI. basis says whether the post gave the full recipe or the AI filled in gaps. */
export type Recipe = {
  dish: string;
  serves: string;
  time: string;
  ingredients: { amount: string; item: string }[];
  steps: string[];
  basis: "post" | "ai";
};

export type Save = {
  id: string;
  kind: Kind;
  status: "processing" | "ready" | "failed";
  url: string | null;
  site: string | null;
  title: string | null;
  summary: string | null;
  note: string | null;
  tags: string[];
  cluster: string | null;
  subgroup: string | null;
  facts: { label: string; value: string }[];
  image_path: string | null;
  file_path: string | null;
  image_w: number | null;
  image_h: number | null;
  is_pale: boolean;
  pinned: boolean;
  /** What kind of thing this is: article, video, music, film or other. Null on older saves. */
  form: string | null;
  /** The page's own opening words, for an article's caption. */
  excerpt: string | null;
  recipe: Recipe | null;
  created_at: string;
  /** Browser only: keeps a tile's place on screen while its temporary id is swapped for the real one. */
  _key?: string;
};

export const SAVE_COLUMNS =
  "id,kind,status,url,site,title,summary,note,tags,cluster,subgroup,facts,image_path,file_path,image_w,image_h,is_pale,pinned,form,excerpt,recipe,created_at";
