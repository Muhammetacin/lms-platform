import type { Metadata } from "next";
import ActivationForm from "./activation-form";

export const metadata: Metadata = {
  title: "Activate your account | LMS Platform",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ActivatePage() {
  return <ActivationForm />;
}
