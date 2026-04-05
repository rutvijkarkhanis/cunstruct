import fevicol1kg from "@/assets/products/fevicol-1kg.jpg";
import fevicol5kg from "@/assets/products/fevicol-5kg.jpg";
import drFixit from "@/assets/products/dr-fixit.jpg";
import siliconeSealant from "@/assets/products/silicone-sealant.jpg";
import whiteCement from "@/assets/products/white-cement.jpg";
import wallPutty from "@/assets/products/wall-putty.jpg";
import nails from "@/assets/products/nails.jpg";
import screws from "@/assets/products/screws.jpg";
import anchorFasteners from "@/assets/products/anchor-fasteners.jpg";
import bindingWire from "@/assets/products/binding-wire.jpg";
import teflonTape from "@/assets/products/teflon-tape.jpg";
import drillBit from "@/assets/products/drill-bit.jpg";
import drillBitSet from "@/assets/products/drill-bit-set.jpg";
import cuttingDisc from "@/assets/products/cutting-disc.jpg";
import grindingWheel from "@/assets/products/grinding-wheel.jpg";
import sandpaper from "@/assets/products/sandpaper.jpg";
import cpvcElbow from "@/assets/products/cpvc-elbow.jpg";
import ballValve from "@/assets/products/ball-valve.jpg";
import basicTap from "@/assets/products/basic-tap.jpg";
import pipeConnector from "@/assets/products/pipe-connector.jpg";
import ultratechCement from "@/assets/products/ultratech-cement.jpg";
import accCement from "@/assets/products/acc-cement.jpg";

export type ProductCategory =
  | "adhesives-chemicals"
  | "hardware-fasteners"
  | "tools-accessories"
  | "plumbing"
  | "heavy-materials";

export type Product = {
  id: string;
  name: string;
  category: ProductCategory;
  price: number;
  weight: number;
  unit: string;
  image: string;
  description: string;
  brand?: string;
  rating: number;
};

export const products: Product[] = [
  // Adhesives & Chemicals
  { id: "ac-1", name: "Fevicol SH 1kg", category: "adhesives-chemicals", price: 320, weight: 1, unit: "pc", image: fevicol1kg, description: "Multipurpose synthetic resin adhesive for wood, laminate, and general carpentry work.", brand: "Fevicol", rating: 4.6 },
  { id: "ac-2", name: "Fevicol SH 5kg", category: "adhesives-chemicals", price: 1400, weight: 5, unit: "pc", image: fevicol5kg, description: "Industrial-size synthetic resin adhesive. Best for bulk carpentry and furniture projects.", brand: "Fevicol", rating: 4.5 },
  { id: "ac-3", name: "Dr Fixit Waterproofing 1L", category: "adhesives-chemicals", price: 280, weight: 1, unit: "pc", image: drFixit, description: "Integral liquid waterproofing compound for concrete and plaster. Prevents dampness and seepage.", brand: "Dr Fixit", rating: 4.4 },
  { id: "ac-4", name: "Silicone Sealant", category: "adhesives-chemicals", price: 180, weight: 0.3, unit: "pc", image: siliconeSealant, description: "Waterproof silicone sealant for bathrooms, kitchens, and window joints.", rating: 4.2 },
  { id: "ac-5", name: "White Cement 1kg", category: "adhesives-chemicals", price: 90, weight: 1, unit: "pc", image: whiteCement, description: "Fine white cement for tile joints, wall finishing, and decorative work.", rating: 4.3 },
  { id: "ac-6", name: "Wall Putty 5kg", category: "adhesives-chemicals", price: 250, weight: 5, unit: "pc", image: wallPutty, description: "White cement-based wall putty for smooth wall finishing before painting.", rating: 4.4 },

  // Hardware & Fasteners
  { id: "hf-1", name: "Nails 1kg", category: "hardware-fasteners", price: 120, weight: 1, unit: "kg", image: nails, description: "Assorted construction nails for general-purpose use in carpentry and framing.", rating: 4.1 },
  { id: "hf-2", name: "Screws Box", category: "hardware-fasteners", price: 180, weight: 1, unit: "box", image: screws, description: "Mixed-size self-tapping screws for wood, metal, and drywall applications.", rating: 4.3 },
  { id: "hf-3", name: "Anchor Fasteners", category: "hardware-fasteners", price: 220, weight: 1, unit: "pack", image: anchorFasteners, description: "Heavy-duty wall anchor fasteners for mounting in concrete and masonry.", rating: 4.4 },
  { id: "hf-4", name: "Binding Wire", category: "hardware-fasteners", price: 90, weight: 1, unit: "kg", image: bindingWire, description: "GI binding wire for tying rebar and reinforcement steel at construction sites.", rating: 4.0 },
  { id: "hf-5", name: "Teflon Tape", category: "hardware-fasteners", price: 20, weight: 0.05, unit: "pc", image: teflonTape, description: "PTFE thread-seal tape for leak-proof plumbing and pipe connections.", rating: 4.2 },

  // Tools & Accessories
  { id: "ta-1", name: "Drill Bit 10mm", category: "tools-accessories", price: 150, weight: 0.2, unit: "pc", image: drillBit, description: "HSS drill bit for masonry and concrete. Fits standard drill chucks.", rating: 4.3 },
  { id: "ta-2", name: "Drill Bit Set", category: "tools-accessories", price: 400, weight: 0.5, unit: "set", image: drillBitSet, description: "Complete multi-size drill bit set for wood, metal, and masonry.", rating: 4.5 },
  { id: "ta-3", name: "Cutting Disc", category: "tools-accessories", price: 90, weight: 0.1, unit: "pc", image: cuttingDisc, description: "Abrasive cutting disc for angle grinders. Cuts metal, tile, and stone.", rating: 4.2 },
  { id: "ta-4", name: "Grinding Wheel", category: "tools-accessories", price: 120, weight: 0.2, unit: "pc", image: grindingWheel, description: "Heavy-duty grinding wheel for surface finishing and deburring.", rating: 4.1 },
  { id: "ta-5", name: "Sandpaper Pack", category: "tools-accessories", price: 100, weight: 0.3, unit: "pack", image: sandpaper, description: "Multi-grit sandpaper sheets for wood and wall surface preparation.", rating: 4.0 },

  // Plumbing
  { id: "pl-1", name: "CPVC Elbow", category: "plumbing", price: 60, weight: 0.2, unit: "pc", image: cpvcElbow, description: "CPVC 90° elbow fitting for hot and cold water piping systems.", rating: 4.2 },
  { id: "pl-2", name: "Ball Valve", category: "plumbing", price: 180, weight: 0.5, unit: "pc", image: ballValve, description: "Brass ball valve for controlling water flow. Quarter-turn operation.", rating: 4.4 },
  { id: "pl-3", name: "Basic Tap", category: "plumbing", price: 250, weight: 0.7, unit: "pc", image: basicTap, description: "Chrome-plated brass tap for kitchen and bathroom use.", rating: 4.3 },
  { id: "pl-4", name: "Pipe Connector", category: "plumbing", price: 80, weight: 0.3, unit: "pc", image: pipeConnector, description: "Universal pipe connector coupling for joining PVC and CPVC pipes.", rating: 4.1 },

  // Heavy Materials
  { id: "hm-1", name: "UltraTech Cement 50kg", category: "heavy-materials", price: 420, weight: 50, unit: "bag", image: ultratechCement, description: "Premium OPC 53 Grade cement for high-strength concrete and RCC work.", brand: "UltraTech", rating: 4.5 },
  { id: "hm-2", name: "ACC Cement 50kg", category: "heavy-materials", price: 415, weight: 50, unit: "bag", image: accCement, description: "PPC cement suitable for all types of construction. Superior chemical resistance.", brand: "ACC", rating: 4.3 },
];

export const categories = [
  { id: "adhesives-chemicals", name: "Adhesives & Chemicals", icon: "🧴" },
  { id: "hardware-fasteners", name: "Hardware & Fasteners", icon: "🔩" },
  { id: "tools-accessories", name: "Tools & Accessories", icon: "🔧" },
  { id: "plumbing", name: "Plumbing", icon: "🚿" },
  { id: "heavy-materials", name: "Heavy Materials", icon: "🏗️" },
] as const;
