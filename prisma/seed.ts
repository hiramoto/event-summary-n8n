import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const places = [
  {
    placeId: "home",
    label: "自宅",
    lat: null,
    lng: null,
    radiusM: 100,
  },
  {
    placeId: "office",
    label: "オフィス",
    lat: null,
    lng: null,
    radiusM: 100,
  },
];

async function main() {
  console.log("Seeding places...");

  for (const place of places) {
    await prisma.place.upsert({
      where: { placeId: place.placeId },
      update: {
        label: place.label,
        lat: place.lat,
        lng: place.lng,
        radiusM: place.radiusM,
      },
      create: place,
    });
    console.log(`  Upserted: ${place.placeId} (${place.label})`);
  }

  console.log("Seeding completed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
