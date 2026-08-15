import RunView from "./RunView";

export default async function RunPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = params.token;
  const token = Array.isArray(raw) ? raw[0] : raw;
  return <RunView key={token ?? ""} token={token ?? ""} />;
}
