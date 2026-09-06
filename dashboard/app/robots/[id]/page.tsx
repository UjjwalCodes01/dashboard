import { RobotDetail } from "@/components/robot/RobotDetail";

export default async function RobotPage({ params }: PageProps<"/robots/[id]">) {
  const { id } = await params;
  return <RobotDetail id={decodeURIComponent(id)} />;
}
