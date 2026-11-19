export type Kind = "link" | "image" | "note" | "file";

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
  image_w: number | null;
  image_h: number | null;
  is_pale: boolean;
  pinned: boolean;
  created_at: string;
};

export const SAVE_COLUMNS =
  "id,kind,status,url,site,title,summary,note,tags,cluster,subgroup,facts,image_path,image_w,image_h,is_pale,pinned,created_at";
