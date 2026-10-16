ALTER TABLE "cafe_settings" ADD COLUMN "inventoryActivatedAt" TIMESTAMP(3);

CREATE FUNCTION preserve_inventory_activation() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."inventoryActivatedAt" IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Inventory activation cannot be removed';
    END IF;
    IF NEW."inventoryActivatedAt" IS DISTINCT FROM OLD."inventoryActivatedAt" THEN
      RAISE EXCEPTION 'Inventory activation cannot be changed';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER preserve_inventory_activation
BEFORE UPDATE OR DELETE ON "cafe_settings"
FOR EACH ROW EXECUTE FUNCTION preserve_inventory_activation();
