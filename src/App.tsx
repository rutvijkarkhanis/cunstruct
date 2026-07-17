import { lazy, Suspense, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CartProvider } from "@/context/CartContext";
import { AuthProvider } from "@/context/AuthContext";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import { Loader2 } from "lucide-react";
import { isAppSubdomain, getAppUrl, getMainUrl } from "@/lib/subdomain";

// ── Storefront pages ─────────────────────────────────────────────────────────
const Index = lazy(() => import("./pages/Index.tsx"));
const Products = lazy(() => import("./pages/Products.tsx"));
const ProductDetail = lazy(() => import("./pages/ProductDetail.tsx"));
const Cart = lazy(() => import("./pages/Cart.tsx"));
const Checkout = lazy(() => import("./pages/Checkout.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const SearchResults = lazy(() => import("./pages/SearchResults.tsx"));
const KitDetail = lazy(() => import("./pages/KitDetail.tsx"));
const Kits = lazy(() => import("./pages/Kits.tsx"));
const Auth = lazy(() => import("./pages/Auth.tsx"));

// ── App-subdomain pages (projects + ops) ─────────────────────────────────────
const MyProjects = lazy(() => import("./pages/MyProjects.tsx"));
const MyProjectDetail = lazy(() => import("./pages/MyProjectDetail.tsx"));
const OpsLayout = lazy(() => import("./components/ops/OpsLayout.tsx"));
const OpsDashboard = lazy(() => import("./pages/ops/OpsDashboard.tsx"));
const OpsProjects = lazy(() => import("./pages/ops/OpsProjects.tsx"));
const OpsProjectDetail = lazy(() => import("./pages/ops/OpsProjectDetail.tsx"));
const OpsStages = lazy(() => import("./pages/ops/OpsStages.tsx"));
const OpsMappings = lazy(() => import("./pages/ops/OpsMappings.tsx"));
const OpsForecasts = lazy(() => import("./pages/ops/OpsForecasts.tsx"));
const OpsBriefings = lazy(() => import("./pages/ops/OpsBriefings.tsx"));
const OpsAnomalies = lazy(() => import("./pages/ops/OpsAnomalies.tsx"));

const PageLoader = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
);

/**
 * Sends the browser to a different origin (main ↔ app subdomain).
 * In dev mode (both surfaces share localhost) it shows a notice instead of
 * redirecting to avoid infinite loops.
 */
function CrossDomainRedirect({ base }: { base: string }) {
  const { pathname, search } = useLocation();
  const target = base + pathname + search;

  useEffect(() => {
    if (!import.meta.env.DEV && base) window.location.replace(target);
  }, [target, base]);

  if (import.meta.env.DEV || !base) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-8">
        <p className="text-sm text-muted-foreground text-center">
          In production this path lives at{" "}
          <a href={target || pathname} className="underline text-primary">
            {target || pathname}
          </a>
          .<br />
          Set <code className="text-xs bg-muted px-1 rounded">VITE_IS_APP_SUBDOMAIN=true</code> or{" "}
          <code className="text-xs bg-muted px-1 rounded">VITE_MAIN_URL</code> /{" "}
          <code className="text-xs bg-muted px-1 rounded">VITE_APP_URL</code> to test locally.
        </p>
      </div>
    );
  }

  return <PageLoader />;
}

/** Routes served on the main storefront domain (cunstruct.com) */
function StorefrontRoutes() {
  const app = getAppUrl();
  return (
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/products" element={<Products />} />
      <Route path="/product/:id" element={<ProductDetail />} />
      <Route path="/cart" element={<Cart />} />
      <Route path="/checkout" element={<Checkout />} />
      <Route path="/search" element={<SearchResults />} />
      <Route path="/kit/:id" element={<KitDetail />} />
      <Route path="/kits" element={<Kits />} />
      <Route path="/auth" element={<Auth />} />
      {/* Projects module lives on the app subdomain — redirect there */}
      <Route path="/my-projects" element={<CrossDomainRedirect base={app} />} />
      <Route path="/my-projects/*" element={<CrossDomainRedirect base={app} />} />
      <Route path="/contractor/*" element={<CrossDomainRedirect base={app} />} />
      <Route path="/ops/*" element={<CrossDomainRedirect base={app} />} />
      <Route path="/ops" element={<CrossDomainRedirect base={app} />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

/** Routes served on the app subdomain (app.cunstruct.com) */
function AppRoutes() {
  const main = getMainUrl();
  return (
    <Routes>
      {/* Root goes straight to the project list */}
      <Route path="/" element={<Navigate to="/my-projects" replace />} />
      <Route path="/auth" element={<Auth />} />
      <Route path="/my-projects" element={<MyProjects />} />
      <Route path="/my-projects/:id" element={<MyProjectDetail />} />
      <Route path="/contractor/my-projects/:id" element={<MyProjectDetail />} />
      <Route path="/ops" element={<OpsLayout />}>
        <Route index element={<OpsDashboard />} />
        <Route path="projects" element={<OpsProjects />} />
        <Route path="projects/:id" element={<OpsProjectDetail />} />
        <Route path="stages" element={<OpsStages />} />
        <Route path="mappings" element={<OpsMappings />} />
        <Route path="forecasts" element={<OpsForecasts />} />
        <Route path="briefings" element={<OpsBriefings />} />
        <Route path="anomalies" element={<OpsAnomalies />} />
      </Route>
      {/* Anything else (storefront paths) → back to the main domain */}
      <Route path="*" element={<CrossDomainRedirect base={main} />} />
    </Routes>
  );
}

const queryClient = new QueryClient();

const App = () => {
  const onApp = isAppSubdomain();

  return (
    <HelmetProvider>
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <CartProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Suspense fallback={<PageLoader />}>
                {onApp ? <AppRoutes /> : <StorefrontRoutes />}
              </Suspense>
            </BrowserRouter>
          </CartProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
    </ErrorBoundary>
    </HelmetProvider>
  );
};

export default App;
