import { InfoCard } from "@/components/shared/InfoCard";
import { explainDown, type ExplainInput } from "@/features/monitors/down-explainer";

export const DownExplainer = ({ input }: { input: ExplainInput }) => <InfoCard title="When is it Down?">{explainDown(input)}</InfoCard>;
