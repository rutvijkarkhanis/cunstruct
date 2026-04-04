export type Product = {
  id: string;
  name: string;
  category: "cement" | "steel" | "sand";
  price: number;
  unit: string;
  image: string;
  description: string;
  brand?: string;
  rating: number;
};

export const products: Product[] = [
  {
    id: "cem-1",
    name: "UltraTech OPC 53 Grade",
    category: "cement",
    price: 380,
    unit: "per bag (50kg)",
    image: "/images/cement.jpg",
    description: "Premium Ordinary Portland Cement ideal for high-strength concrete work, RCC, and pre-stressed structures. Meets IS 12269 standards.",
    brand: "UltraTech",
    rating: 4.5,
  },
  {
    id: "cem-2",
    name: "ACC PPC Cement",
    category: "cement",
    price: 350,
    unit: "per bag (50kg)",
    image: "/images/cement.jpg",
    description: "Portland Pozzolana Cement suitable for all types of construction. Superior resistance to chemical attacks and cracks.",
    brand: "ACC",
    rating: 4.3,
  },
  {
    id: "cem-3",
    name: "Ambuja Plus Cement",
    category: "cement",
    price: 370,
    unit: "per bag (50kg)",
    image: "/images/cement.jpg",
    description: "High-performance cement with moisture-resistant formula. Best for foundations, slabs, and plastering.",
    brand: "Ambuja",
    rating: 4.4,
  },
  {
    id: "stl-1",
    name: "TATA Tiscon Fe 500D",
    category: "steel",
    price: 65,
    unit: "per kg",
    image: "/images/steel.jpg",
    description: "High-strength TMT rebars with superior ductility and weldability. Earthquake-resistant, corrosion-resistant.",
    brand: "TATA",
    rating: 4.7,
  },
  {
    id: "stl-2",
    name: "JSW NeoSteel 600",
    category: "steel",
    price: 62,
    unit: "per kg",
    image: "/images/steel.jpg",
    description: "Next-gen TMT bars with higher elongation. Ideal for multi-story buildings and heavy-duty construction.",
    brand: "JSW",
    rating: 4.5,
  },
  {
    id: "stl-3",
    name: "SAIL TMT Fe 500",
    category: "steel",
    price: 58,
    unit: "per kg",
    image: "/images/steel.jpg",
    description: "Government-standard TMT steel bars. Reliable quality for residential and commercial construction.",
    brand: "SAIL",
    rating: 4.2,
  },
  {
    id: "snd-1",
    name: "M-Sand (Manufactured)",
    category: "sand",
    price: 45,
    unit: "per cft",
    image: "/images/sand.jpg",
    description: "Eco-friendly manufactured sand with consistent grading. Free from clay, silt, and organic impurities.",
    rating: 4.4,
  },
  {
    id: "snd-2",
    name: "River Sand (Fine)",
    category: "sand",
    price: 55,
    unit: "per cft",
    image: "/images/sand.jpg",
    description: "Natural fine river sand ideal for plastering and finishing work. Well-graded with uniform particle size.",
    rating: 4.3,
  },
  {
    id: "snd-3",
    name: "P-Sand (Plastering)",
    category: "sand",
    price: 40,
    unit: "per cft",
    image: "/images/sand.jpg",
    description: "Specially manufactured plastering sand with smooth finish. Reduces water consumption and improves workability.",
    rating: 4.1,
  },
];

export const categories = [
  { id: "cement", name: "Cement", count: 3 },
  { id: "steel", name: "Steel", count: 3 },
  { id: "sand", name: "Sand", count: 3 },
] as const;
