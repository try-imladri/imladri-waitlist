import { PreferenceAction } from "@/components/waitlist/confirmation";
export const metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };
export default function Page() { return <PreferenceAction kind="unsubscribe" />; }
