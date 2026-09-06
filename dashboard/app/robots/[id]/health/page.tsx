import { RobotHealth } from "@/components/robot/RobotHealth";

export default async function RobotHealthPage({ params }: PageProps<"/robots/[id]/health">) {
  const { id } = await params;
  return <RobotHealth id={decodeURIComponent(id)} />;
}
