import { Landing } from "@/components/waitlist/landing";

export const metadata = { alternates: { canonical: "https://imladri.com/" } };

const siteIdentity = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://imladri.com/#website",
      name: "Imladri",
      url: "https://imladri.com/",
      description: "Dating without the swiping. A few compatible matches a week, picked from your answers. Join the Imladri waitlist.",
      publisher: { "@id": "https://imladri.com/#organization" },
      inLanguage: "en-US",
    },
    {
      "@type": "Organization",
      "@id": "https://imladri.com/#organization",
      name: "Imladri",
      url: "https://imladri.com/",
      description: "Dating without the swiping. Join the Imladri waitlist.",
    },
  ],
};

export default function Home() {
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteIdentity).replace(/</g, "\\u003c") }} /><Landing /></>;
}
