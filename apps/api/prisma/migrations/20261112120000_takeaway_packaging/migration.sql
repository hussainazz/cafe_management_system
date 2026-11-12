ALTER TABLE "product_costing_configurations" ADD COLUMN "takeawayPackaging" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "product_costing_configurations" ADD CONSTRAINT "takeaway_packaging_array" CHECK (jsonb_typeof("takeawayPackaging") = 'array');
