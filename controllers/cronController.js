const db = require("../models");
const { Op } = require("sequelize");

module.exports = {
  checkExpirations: async (req, res) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find documents that have an expiration date
      const documents = await db.EntityDocument.findAll({
        where: {
          expiration_date: { [Op.not]: null },
          alert_status: { [Op.in]: ["pending", "warned"] }
        }
      });

      const expiringSoon = [];
      const expired = [];

      for (const doc of documents) {
        const expDate = new Date(doc.expiration_date + "T00:00:00");
        const notifyDays = doc.notify_days_before || 15;
        
        const diffTime = expDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0 && doc.alert_status !== "expired_warned") {
          // It's expired and we haven't sent the expired warning yet
          await doc.update({ alert_status: "expired_warned" });
          expired.push(doc);
        } else if (diffDays >= 0 && diffDays <= notifyDays && doc.alert_status === "pending") {
          // It's expiring soon and we haven't sent ANY warning yet
          await doc.update({ alert_status: "warned" });
          expiringSoon.push(doc);
        }
      }

      // If we have any alerts, we would send them to the external email service here
      if (expiringSoon.length > 0 || expired.length > 0) {
        const payload = {
          expiring_soon: expiringSoon,
          expired: expired,
          timestamp: new Date().toISOString()
        };

        console.log("[CRON] Sending expiration alerts:", payload);
        
        // TODO: Implement the fetch to the Next.js email service
        // Example:
        // await fetch(`${process.env.EMAIL_SERVICE_URL}/send-expiration-alerts`, {
        //   method: 'POST',
        //   headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.EMAIL_SERVICE_SECRET}` },
        //   body: JSON.stringify(payload)
        // });
      }

      return res.status(200).json({ 
        message: "Expiration check completed successfully.",
        processed: {
          expiring_soon: expiringSoon.length,
          expired: expired.length
        }
      });
    } catch (error) {
      console.error("[CRON] Error checking expirations:", error);
      return res.status(500).json({ error: error.message });
    }
  }
};
