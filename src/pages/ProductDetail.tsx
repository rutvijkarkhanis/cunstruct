import { useParams, Link, useNavigate } from "react-router-dom";
import { Minus, Plus, ShoppingCart, Loader2 } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useSupabaseProducts } from "@/hooks/useSupabaseProducts";
import { useCart } from "@/context/CartContext";
import { toast } from "sonner";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { extractVariantLabel } from "@/lib/productGroupUtils";
import GroupedProductCard, { groupProducts } from "@/components/GroupedProductCard";
import { resolveKits, suggestKitFor } from "@/lib/kits";
import SEO, { SITE_URL } from "@/components/SEO";

const ProductDetail = () => {
  const { id } = useParams();
  const { addToCart } = useCart();
  const navigate = useNavigate();
  const [qty, setQty] = useState(1);
  const { data: allProducts, isLoading } = useSupabaseProducts();

  // Always open the product page from the top; defeat scroll restoration.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  // Find clicked product and its group siblings
  const { group, selectedIdx: initialIdx } = useMemo(() => {
    if (!allProducts || !id) return { group: [], selectedIdx: 0 };
    const clicked = allProducts.find((p) => p.id === id);
    if (!clicked) return { group: [], selectedIdx: 0 };
    const groupName = clicked.group_name || clicked.name;
    const siblings = allProducts.filter(
      (p) => (p.group_name || p.name) === groupName
    );
    const idx = siblings.findIndex((p) => p.id === id);
    return { group: siblings, selectedIdx: idx >= 0 ? idx : 0 };
  }, [allProducts, id]);

  const [selectedIdx, setSelectedIdx] = useState(initialIdx);
  useEffect(() => setSelectedIdx(initialIdx), [initialIdx]);

  const product = group[selectedIdx];

  // Similar products: same subcategory, different group
  const similarGroups = useMemo(() => {
    if (!allProducts || !product) return [];
    const currentGroupName = product.group_name || product.name;
    const sameSub = allProducts.filter(
      (p) =>
        p.subcategory &&
        product.subcategory &&
        p.subcategory === product.subcategory &&
        (p.group_name || p.name) !== currentGroupName,
    );
    return groupProducts(sameSub).slice(0, 6);
  }, [allProducts, product]);

  const kits = useMemo(() => (allProducts ? resolveKits(allProducts) : []), [allProducts]);
  const [descExpanded, setDescExpanded] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Product not found</p>
      </div>
    );
  }

  const groupName = product.group_name?.trim() || product.name;
  const brand = product.brand ?? "";
  const productName = groupName;
  const hasVariants = group.length > 1;

  const handleAdd = () => {
    addToCart(product, qty);
    toast.success(`${qty}x ${product.name} added to cart`);
    const suggested = suggestKitFor(product, kits);
    if (suggested) {
      toast.message(`Complete your job with ${suggested.def.name}`, {
        description: `${suggested.products.length} items · ₹${suggested.totalPrice.toLocaleString("en-IN")}`,
        action: {
          label: "View Kit",
          onClick: () => navigate(`/kit/${suggested.def.id}`),
        },
      });
    }
  };

  const categoryLabel = product.subcategory || product.main_category;
  const description =
    product.description?.trim() ||
    `${brand ? brand + " " : ""}${productName}${categoryLabel ? " — " + categoryLabel : ""}. Construction-grade quality, delivered in 30 minutes by Cunstruct.`;
  const isLong = description.length > 160;

  const seoDescription = `${brand ? brand + " " : ""}${productName} — ${description.slice(0, 140)}${description.length > 140 ? "…" : ""}`;

  const breadcrumbItems = [
    { name: "Home", url: `${SITE_URL}/` },
    ...(product.main_category
      ? [{ name: product.main_category, url: `${SITE_URL}/products?category=${encodeURIComponent(product.main_category)}` }]
      : []),
    ...(product.subcategory
      ? [{ name: product.subcategory, url: `${SITE_URL}/products?category=${encodeURIComponent(product.main_category ?? "")}&sub=${encodeURIComponent(product.subcategory)}` }]
      : []),
    { name: productName, url: `${SITE_URL}/product/${product.id}` },
  ];

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: productName,
      description: description,
      image: product.image_url,
      sku: product.id,
      brand: brand ? { "@type": "Brand", name: brand } : undefined,
      offers: {
        "@type": "Offer",
        price: product.selling_price,
        priceCurrency: "INR",
        availability: "https://schema.org/InStock",
        url: `${SITE_URL}/product/${product.id}`,
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbItems.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        item: item.url,
      })),
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={`${brand ? brand + " " : ""}${productName}`}
        description={seoDescription}
        image={product.image_url}
        type="product"
        canonicalPath={`/product/${product.id}`}
        jsonLd={jsonLd}
      />
      <Header />
      <div className="container py-4">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3 flex-wrap">
          <Link to="/" className="hover:text-foreground">Home</Link>
          {product.main_category && (
            <>
              <span>/</span>
              <Link
                to={`/products?category=${encodeURIComponent(product.main_category)}`}
                className="hover:text-foreground"
              >
                {product.main_category}
              </Link>
            </>
          )}
          {product.subcategory && (
            <>
              <span>/</span>
              <Link
                to={`/products?category=${encodeURIComponent(product.main_category ?? "")}&sub=${encodeURIComponent(product.subcategory)}`}
                className="hover:text-foreground"
              >
                {product.subcategory}
              </Link>
            </>
          )}
          <span>/</span>
          <span className="text-foreground line-clamp-1">{productName}</span>
        </nav>

        <div className="max-w-lg mx-auto">
          {/* Image */}
          <div className="bg-card rounded-xl border p-4 sm:p-6">
            <div className="aspect-square max-h-64 sm:max-h-72 w-full flex items-center justify-center mx-auto">
              <img src={product.image_url} alt={product.name} className="max-h-full max-w-[80%] object-contain" />
            </div>
          </div>

          {/* Info */}
          <div className="mt-4 space-y-3">
            {brand && (
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {brand}
              </span>
            )}
            <h1 className="text-xl font-bold text-foreground">{productName}</h1>

            {/* Description */}
            <div className="text-sm text-muted-foreground leading-relaxed">
              <p className={!descExpanded && isLong ? "line-clamp-2" : ""}>{description}</p>
              {isLong && (
                <button
                  onClick={() => setDescExpanded((v) => !v)}
                  className="mt-1 text-xs font-semibold text-accent hover:underline"
                >
                  {descExpanded ? "Show less" : "Read more"}
                </button>
              )}
            </div>

            {/* Variant selector */}
            {hasVariants && (
              <div className="flex flex-wrap gap-2">
                {group.map((p, i) => {
                  const label = p.variant_name?.trim() || extractVariantLabel(p.name, productName);
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedIdx(i)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        i === selectedIdx
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary text-foreground border-border hover:border-primary/40"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Price + Qty + Add */}
            <div className="pt-3 border-t space-y-4">
              <div className="flex items-end justify-between">
                <span className="text-2xl font-bold text-foreground">₹{product.selling_price}</span>
                <div className="flex items-center gap-3 bg-secondary rounded-xl px-2 py-1">
                  <button onClick={() => setQty(Math.max(1, qty - 1))} className="p-1.5 active:scale-90 transition-transform">
                    <Minus className="h-4 w-4 text-foreground" />
                  </button>
                  <span className="text-sm font-semibold text-foreground w-6 text-center">{qty}</span>
                  <button onClick={() => setQty(qty + 1)} className="p-1.5 active:scale-90 transition-transform">
                    <Plus className="h-4 w-4 text-foreground" />
                  </button>
                </div>
              </div>

              <Button
                onClick={handleAdd}
                className="w-full max-w-sm mx-auto flex h-12 text-base font-semibold rounded-xl shadow-md hover:brightness-110 hover:scale-[1.02] active:scale-[0.98] transition-all"
              >
                <ShoppingCart className="h-5 w-5 mr-2" />
                Add to Cart — ₹{product.selling_price * qty}
              </Button>
            </div>
          </div>
        </div>

        {/* Similar Products */}
        {similarGroups.length > 0 && (
          <div className="mt-10 max-w-5xl mx-auto">
            <h2 className="text-base font-bold text-foreground mb-3">Similar Products</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {similarGroups.map((g) => (
                <GroupedProductCard key={g.groupName} group={g} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductDetail;
