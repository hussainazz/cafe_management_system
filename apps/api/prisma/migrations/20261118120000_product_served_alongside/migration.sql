ALTER TABLE "product_costing_configurations"
  ADD COLUMN "servedAlongside" JSONB NOT NULL DEFAULT '[]',
  ADD CONSTRAINT "product_served_alongside_array"
    CHECK (jsonb_typeof("servedAlongside") = 'array');
