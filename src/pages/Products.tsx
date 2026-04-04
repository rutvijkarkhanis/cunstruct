import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Clock } from "lucide-react";
import Header from "@/components/Header";
import ProductCard from "@/components/ProductCard";
import { products } from "@/data/products";

const Products = () => {
  const [params] = useSearchParams();
  const category = params.get("category");

  const filtered = category
    ? products.filter((p) => p.category === category)
    : products;

  const title = category
    ? category.charAt(0).toUpperCase() + category.slice(1)
    : "All Products";

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container py-4">
        <div className="flex items-center gap-3 mb-4">
          <Link to="/" className="p-1">
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </Link>
          <h1 className="text-xl font-bold text-foreground">{title}</h1>
        </div>

        <div className="flex items-center gap-2 mb-4 bg-success/10 rounded-lg px-3 py-2">
          <Clock className="h-4 w-4 text-success" />
          <span className="text-sm font-medium text-success">Delivery in 60 mins</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {filtered.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Products;
