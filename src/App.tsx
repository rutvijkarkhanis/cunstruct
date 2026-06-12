import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CartProvider } from "@/context/CartContext";
import { AuthProvider } from "@/context/AuthContext";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import { Loader2 } from "lucide-react";

// Route-level code splitting — each page loads only when navigated to
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
const MyProjects = lazy(() => import("./pages/MyProjects.tsx"));
const MyProjectDetail = lazy(() => import("./pages/MyProjectDetail.tsx"));
const OpsLayout = lazy(() => import("./components/ops/OpsLayout.tsx"));
const OpsDashboard = lazy(() => import("./pages/ops/OpsDashboard.tsx"));
const OpsProjects = lazy(() => import("./pages/ops/OpsProjects.tsx"));
const OpsProjectDetail = lazy(() => import("./pages/ops/OpsProjectDetail.tsx"));
const OpsStages = lazy(() => import("./pages/ops/OpsStages.tsx"));
const OpsMappings = lazy(() => import("./pages/ops/OpsMappings.tsx"));
const OpsForecasts = lazy(() => import("./pages/ops/OpsForecasts.tsx"));

const PageLoader = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
);

const queryClient = new QueryClient();

const App = () => (
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
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </CartProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
  </ErrorBoundary>
  </HelmetProvider>
);

export default App;
