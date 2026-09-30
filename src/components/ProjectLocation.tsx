export default function ProjectLocation({
  remote = false,
  label,
  detail,
}: {
  remote?: boolean;
  label?: string;
  detail?: string;
}) {
  return (
    <span
      className={`project-location ${remote ? "is-remote" : "is-local"}`}
      title={detail || label}
    >
      <b>{remote ? "远端" : "本地"}</b>
      {label && <span className="location-detail">{label}</span>}
    </span>
  );
}
