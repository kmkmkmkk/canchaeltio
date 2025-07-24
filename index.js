var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/index.ts
import express2 from "express";

// server/routes.ts
import { createServer } from "http";

// shared/schema.ts
var schema_exports = {};
__export(schema_exports, {
  bookings: () => bookings,
  insertBookingSchema: () => insertBookingSchema,
  insertUserSchema: () => insertUserSchema,
  updateBookingSchema: () => updateBookingSchema,
  users: () => users
});
import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
var users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull()
});
var bookings = pgTable("bookings", {
  id: serial("id").primaryKey(),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerEmail: text("customer_email").notNull(),
  bookingDate: text("booking_date").notNull(),
  // YYYY-MM-DD format
  bookingTime: text("booking_time").notNull(),
  // HH:MM format
  totalPrice: integer("total_price").notNull().default(2e4),
  depositAmount: integer("deposit_amount").notNull().default(6e3),
  isPaid: boolean("is_paid").notNull().default(false),
  isConfirmed: boolean("is_confirmed").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow()
});
var insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true
});
var insertBookingSchema = createInsertSchema(bookings).omit({
  id: true,
  createdAt: true
});
var updateBookingSchema = createInsertSchema(bookings).pick({
  isPaid: true,
  isConfirmed: true
});

// server/db.ts
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
neonConfig.webSocketConstructor = ws;
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?"
  );
}
var pool = new Pool({ connectionString: process.env.DATABASE_URL });
var db = drizzle({ client: pool, schema: schema_exports });

// server/storage.ts
import { eq, and } from "drizzle-orm";
var DatabaseStorage = class {
  async getUser(id) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || void 0;
  }
  async getUserByUsername(username) {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || void 0;
  }
  async createUser(insertUser) {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }
  async createBooking(booking) {
    const [newBooking] = await db.insert(bookings).values(booking).returning();
    return newBooking;
  }
  async getBooking(id) {
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id));
    return booking || void 0;
  }
  async getBookingsByDate(date) {
    return await db.select().from(bookings).where(eq(bookings.bookingDate, date));
  }
  async getBookingsByEmail(email) {
    const userBookings = await db.select().from(bookings).where(and(
      eq(bookings.customerEmail, email),
      eq(bookings.isConfirmed, true)
    )).orderBy(bookings.bookingDate, bookings.bookingTime);
    return userBookings;
  }
  async updateBooking(id, updates) {
    const [updatedBooking] = await db.update(bookings).set(updates).where(eq(bookings.id, id)).returning();
    return updatedBooking || void 0;
  }
  async getAvailableSlots(date) {
    const bookedSlots = await db.select({ time: bookings.bookingTime }).from(bookings).where(and(
      eq(bookings.bookingDate, date),
      eq(bookings.isConfirmed, true)
    ));
    const bookedTimes = bookedSlots.map((slot) => slot.time);
    const allSlots = [];
    for (let hour = 10; hour <= 23; hour++) {
      allSlots.push(`${hour.toString().padStart(2, "0")}:00`);
    }
    allSlots.push("00:00");
    const dayOfWeek = new Date(date).getDay();
    const restrictedSlots = [];
    if (dayOfWeek === 1 || dayOfWeek === 3) {
      restrictedSlots.push("17:00", "18:00");
    }
    if (dayOfWeek === 2 || dayOfWeek === 4) {
      restrictedSlots.push("17:00", "18:00", "19:00");
    }
    return allSlots.filter(
      (slot) => !bookedTimes.includes(slot) && !restrictedSlots.includes(slot)
    );
  }
  async isSlotAvailable(date, time) {
    const [existingBooking] = await db.select().from(bookings).where(and(
      eq(bookings.bookingDate, date),
      eq(bookings.bookingTime, time),
      eq(bookings.isConfirmed, true)
    ));
    return !existingBooking;
  }
};
var storage = new DatabaseStorage();

// server/routes.ts
import { z } from "zod";
async function registerRoutes(app2) {
  app2.get("/api/bookings/available/:date", async (req, res) => {
    try {
      const { date } = req.params;
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        return res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD" });
      }
      const availableSlots = await storage.getAvailableSlots(date);
      res.json({ availableSlots });
    } catch (error) {
      console.error("Error fetching available slots:", error);
      res.status(500).json({ message: "Error fetching available slots" });
    }
  });
  app2.get("/api/admin/bookings/:date", async (req, res) => {
    try {
      const { date } = req.params;
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        return res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD" });
      }
      const bookings2 = await storage.getBookingsByDate(date);
      res.json(bookings2);
    } catch (error) {
      console.error("Error fetching bookings for admin:", error);
      res.status(500).json({ message: "Error fetching bookings" });
    }
  });
  app2.get("/api/bookings/by-email/:email", async (req, res) => {
    try {
      const { email } = req.params;
      const bookings2 = await storage.getBookingsByEmail(email);
      res.json(bookings2);
    } catch (error) {
      console.error("Error fetching bookings by email:", error);
      res.status(500).json({ message: "Error fetching bookings" });
    }
  });
  app2.post("/api/bookings", async (req, res) => {
    try {
      const validatedData = insertBookingSchema.parse(req.body);
      const isAvailable = await storage.isSlotAvailable(
        validatedData.bookingDate,
        validatedData.bookingTime
      );
      if (!isAvailable) {
        return res.status(409).json({
          message: "Este horario ya no est\xE1 disponible. Por favor selecciona otro."
        });
      }
      const bookingWithDefaults = {
        ...validatedData,
        totalPrice: validatedData.totalPrice || 2e4,
        depositAmount: validatedData.depositAmount || 6e3,
        isPaid: validatedData.isPaid || false,
        isConfirmed: validatedData.isConfirmed || false
      };
      const booking = await storage.createBooking(bookingWithDefaults);
      res.status(201).json(booking);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Datos inv\xE1lidos",
          errors: error.errors
        });
      }
      console.error("Error creating booking:", error);
      res.status(500).json({ message: "Error al crear la reserva" });
    }
  });
  app2.get("/api/bookings/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid booking ID" });
      }
      const booking = await storage.getBooking(id);
      if (!booking) {
        return res.status(404).json({ message: "Reserva no encontrada" });
      }
      res.json(booking);
    } catch (error) {
      console.error("Error fetching booking:", error);
      res.status(500).json({ message: "Error al obtener la reserva" });
    }
  });
  app2.patch("/api/bookings/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid booking ID" });
      }
      const validatedData = updateBookingSchema.parse(req.body);
      const updatedBooking = await storage.updateBooking(id, validatedData);
      if (!updatedBooking) {
        return res.status(404).json({ message: "Reserva no encontrada" });
      }
      res.json(updatedBooking);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Datos inv\xE1lidos",
          errors: error.errors
        });
      }
      console.error("Error updating booking:", error);
      res.status(500).json({ message: "Error al actualizar la reserva" });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/vite.ts
import express from "express";
import fs from "fs";
import path2 from "path";
import { createServer as createViteServer, createLogger } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
var vite_config_default = defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...process.env.NODE_ENV !== "production" && process.env.REPL_ID !== void 0 ? [
      await import("@replit/vite-plugin-cartographer").then(
        (m) => m.cartographer()
      )
    ] : []
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/vite.ts
import { nanoid } from "nanoid";
var viteLogger = createLogger();
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
async function setupVite(app2, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      }
    },
    server: serverOptions,
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app2) {
  const distPath = path2.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app2.use(express.static(distPath));
  app2.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/index.ts
var app = express2();
app.use(express2.json());
app.use(express2.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const start = Date.now();
  const path3 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path3.startsWith("/api")) {
      let logLine = `${req.method} ${path3} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });
  next();
});
(async () => {
  const server = await registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true
  }, () => {
    log(`serving on port ${port}`);
  });
})();
