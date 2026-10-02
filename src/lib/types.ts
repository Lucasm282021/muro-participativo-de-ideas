export type Activity = {
  id: string;
  public_code: string;
  title: string;
  question: string;
  status: "draft" | "open" | "closed";
  moderation_mode: "automatic" | "approval";
  created_at: string;
  opened_at: string | null;
  closed_at: string | null;
};

export type Idea = {
  id: string;
  activity_id: string;
  content: string;
  status: "pending" | "published" | "hidden";
  created_at: string;
  published_at: string | null;
};
