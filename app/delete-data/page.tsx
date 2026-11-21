import { PreferenceAction } from "@/components/waitlist/confirmation";
export const metadata = { title: "Delete your waitlist data", robots: { index: false, follow: false } };
export default function Page() { return <PreferenceAction kind="delete" />; }
