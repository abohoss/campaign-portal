import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { AuthGate } from "./features/auth/AuthGate.js";
import { ImportPage } from "./features/import/ImportPage.js";
import { DashboardPage } from "./features/dashboard/DashboardPage.js";
import { ContactsPage } from "./features/contacts/ContactsPage.js";
import { CampaignsPage } from "./features/campaigns/CampaignsPage.js";
import { CampaignDetailPage } from "./features/campaigns/CampaignDetailPage.js";
import { SharedPage } from "./features/share/SharedPage.js";
import { supabase } from "./lib/supabase.js";
import type { Membership } from "./features/auth/useMembership.js";

const NAV_LINK_CLASS = ({ isActive }: { isActive: boolean }): string =>
  `flex min-h-11 items-center border-b-2 px-3 text-sm font-medium transition-colors ${
    isActive
      ? "border-primary text-foreground"
      : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
  }`;

/** "/shared" is the one route a stranger with no session must reach — it's outside AuthGate
 *  entirely, unlike every other route in this app. */
export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/shared" element={<SharedPage />} />
        <Route path="/*" element={<AuthenticatedApp />} />
      </Routes>
    </BrowserRouter>
  );
}

function AuthenticatedApp(): JSX.Element {
  return (
    <AuthGate>
      {(membership) => (
        <div className="min-h-screen text-foreground">
          <header className="relative flex flex-wrap items-center justify-between gap-2 border-b border-border border-t-4 border-t-primary/80 bg-card/95 px-4 py-3 shadow-sm backdrop-blur sm:px-6">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="h-9 w-1 rounded-full bg-primary" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Velocity Growth</p>
                <h1 className="text-base font-semibold leading-tight">{membership.brandName}</h1>
              <p className="text-xs capitalize text-muted-foreground">Signed in as {membership.role}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void supabase.auth.signOut()}
              className="min-h-11 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              Sign out
            </button>
          </header>
          <nav className="flex gap-1 overflow-x-auto border-b border-border bg-card/80 px-2 shadow-[0_1px_8px_hsl(177_55%_24%/0.04)] backdrop-blur sm:px-4">
            <NavLink to="/" end className={NAV_LINK_CLASS}>
              Dashboard
            </NavLink>
            <NavLink to="/contacts" className={NAV_LINK_CLASS}>
              Contacts
            </NavLink>
            <NavLink to="/campaigns" className={NAV_LINK_CLASS}>
              Campaigns
            </NavLink>
            <NavLink to="/import" className={NAV_LINK_CLASS}>
              Import
            </NavLink>
          </nav>
          <main>
            <AppRoutes membership={membership} />
          </main>
        </div>
      )}
    </AuthGate>
  );
}

function AppRoutes({ membership }: { membership: Membership }): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage membership={membership} />} />
      <Route path="/contacts" element={<ContactsPage membership={membership} />} />
      <Route path="/campaigns" element={<CampaignsPage membership={membership} />} />
      <Route path="/campaigns/:campaignId" element={<CampaignDetailPage membership={membership} />} />
      <Route path="/import" element={<ImportPage membership={membership} />} />
    </Routes>
  );
}
