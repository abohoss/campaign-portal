import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { AuthGate } from "./features/auth/AuthGate.js";
import { ImportPage } from "./features/import/ImportPage.js";
import { DashboardPage } from "./features/dashboard/DashboardPage.js";
import { ContactsPage } from "./features/contacts/ContactsPage.js";
import { CampaignsPage } from "./features/campaigns/CampaignsPage.js";
import { CampaignDetailPage } from "./features/campaigns/CampaignDetailPage.js";
import { supabase } from "./lib/supabase.js";
import type { Membership } from "./features/auth/useMembership.js";

const NAV_LINK_CLASS = ({ isActive }: { isActive: boolean }): string =>
  `flex min-h-11 items-center px-3 text-sm ${isActive ? "font-medium text-foreground" : "text-muted-foreground"}`;

export function App(): JSX.Element {
  return (
    <AuthGate>
      {(membership) => (
        <BrowserRouter>
          <div className="min-h-screen bg-background text-foreground">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
              <div>
                <h1 className="text-lg font-semibold">{membership.brandName}</h1>
                <p className="text-xs text-muted-foreground">Signed in as {membership.role}</p>
              </div>
              <button
                type="button"
                onClick={() => void supabase.auth.signOut()}
                className="min-h-11 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium"
              >
                Sign out
              </button>
            </header>
            <nav className="flex gap-1 overflow-x-auto border-b border-border px-2">
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
            <AppRoutes membership={membership} />
          </div>
        </BrowserRouter>
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
