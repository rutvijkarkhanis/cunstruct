import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CartProvider } from "@/context/CartContext";
import { AuthProvider } from "@/context/AuthContext";
import Index from "./pages/Index.tsx";
import Products from "./pages/Products.tsx";
import ProductDetail from "./pages/ProductDetail.tsx";
import Cart from "./pages/Cart.tsx";
import Checkout from "./pages/Checkout.tsx";
import NotFound from "./pages/NotFound.tsx";
import SearchResults from "./pages/SearchResults.tsx";
import KitDetail from "./pages/KitDetail.tsx";
import Kits from "./pages/Kits.tsx";
import Auth from "./pages/Auth.tsx";
import MyProjects from "./pages/MyProjects.tsx";
import MyProjectDetail from "./pages/MyProjectDetail.tsx";
import OpsLayout from "./components/ops/OpsLayout.tsx";
import OpsDashboard from "./pages/ops/OpsDashboard.tsx";
import OpsProjects from "./pages/ops/OpsProjects.tsx";
import OpsProjectDetail from "./pages/ops/OpsProjectDetail.tsx";
import OpsStages from "./pages/ops/OpsStages.tsx";
import OpsMappings from "./pages/ops/OpsMappings.tsx";
import OpsForecasts from "./pages/ops/OpsForecasts.tsx";
import ErrorBoundary from "./components/ErrorBoundary.tsx";


const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <CartProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
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
          </BrowserRouter>
        </CartProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
