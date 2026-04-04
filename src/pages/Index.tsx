import { Link } from "react-router-dom";
import { Clock, ChevronRight } from "lucide-react";
import Header from "@/components/Header";
import ProductCard from "@/components/ProductCard";
import { products } from "@/data/products";
import cementImg from "@/assets/cement.jpg";
import steelImg from "@/assets/steel.jpg";
import sandImg from "@/assets/sand.jpg";

const categoryImages: Record<string, string> = {
  cement: cementImg,
  steel: steelImg,
  sand: sandImg,
};

const categories = [
  { id: "cement", name: "Cement", desc: "OPC, PPC & more" },
  { id: "steel", name: "Steel", desc: "TMT bars & rebars" },
  { id: "sand", name: "Sand", desc: "M-Sand, River sand" },
];

const Index = () => {
  const featured = products.slice(0, 4);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero banner */}
      <div className="container pt-4 pb-2">
        <div className="bg-primary rounded-xl p-5 space-y-2">
          <h1 className="text-xl font-bold text-primary-foreground leading-tight">
            Construction Materials
            <br />
            <span className="text-accent">Delivered Fast.</span>
          </h1>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium text-primary-foreground/80">
              Delivery in 60 mins
            </span>
          </div>
        </div>
      </div>

      {/* Categories */}
      <div className="container py-4">
        <h2 className="text-base font-bold text-foreground mb-3">Shop by Category</h2>
        <div className="grid grid-cols-3 gap-3">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              to={`/products?category=${cat.id}`}
              className="group bg-card rounded-lg border overflow-hidden"
            >
              <div className="aspect-square overflow-hidden">
                <img
                  src={categoryImages[cat.id]}
                  alt={cat.name}
                  width={200}
                  height={200}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              </div>
              <div className="p-2 text-center">
                <span className="text-sm font-semibold text-foreground">{cat.name}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Featured */}
      <div className="container py-2 pb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-foreground">Popular Products</h2>
          <Link to="/products" className="text-xs font-medium text-accent flex items-center gap-0.5">
            View All <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {featured.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Index;
