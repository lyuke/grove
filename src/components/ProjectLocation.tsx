import { Monitor, Server } from "lucide-react";

export default function ProjectLocation({
  remote = false,
  label,
  detail,
}: {
  remote?: boolean;
  label?: string;
  detail?: string;
}) {
  const Icon = remote ? Server : Monitor;
  return (
    <span
      className={`project-location ${remote ? "is-remote" : "is-local"}`}
      title={detail || label}
    >
      <Icon size={12} aria-hidden="true" />
      <b>{remote ? "远端" : "本地"}</b>
      {label && <span className="location-detail">{label}</span>}
    </span>
  );
}
