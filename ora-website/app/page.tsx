import { Hero } from "@/components/home/hero";
import { Principles } from "@/components/home/principles";
import {
  DesktopSection,
  AppStoreSection,
  FilesSection,
  ShareSection,
  StreamingSection,
} from "@/components/home/product";
import { OraSection, AutomationsSection, WidgetsSection } from "@/components/home/intelligence";
import {
  PrivacySection,
  InstallSection,
  CommunitySection,
  FinalCta,
} from "@/components/home/foundation";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Principles />
      <DesktopSection />
      <AppStoreSection />
      <FilesSection />
      <ShareSection />
      <StreamingSection />
      <OraSection />
      <AutomationsSection />
      <WidgetsSection />
      <PrivacySection />
      <InstallSection />
      <CommunitySection />
      <FinalCta />
    </>
  );
}
