-- D275, E3. Existing branches start without a pin. Add columns in place to preserve branch foreign keys.
ALTER TABLE `branches` ADD `latitude` real;
--> statement-breakpoint
ALTER TABLE `branches` ADD `longitude` real CONSTRAINT "branches_pin_check" CHECK (
  ("latitude" is null and "longitude" is null) or
  ("latitude" is not null and "longitude" is not null and "latitude" between -90 and 90 and "longitude" between -180 and 180)
);
