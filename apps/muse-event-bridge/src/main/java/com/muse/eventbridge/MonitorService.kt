package com.muse.eventbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Log

/** Foreground service: polls usage events on a timer and drains the send queue. */
class MonitorService : Service() {
    companion object {
        private const val TAG = "MonitorService"
        private const val CHANNEL = "monitor"
        private const val NOTIFICATION_ID = 1
        const val ACTION_FLUSH = "com.muse.eventbridge.FLUSH"
        const val ACTION_STOP = "com.muse.eventbridge.STOP"

        fun start(context: Context) {
            Prefs(context).monitoringEnabled = true
            context.startForegroundService(Intent(context, MonitorService::class.java))
        }

        fun stop(context: Context) {
            val prefs = Prefs(context)
            prefs.monitoringEnabled = false
            prefs.resetTracker()
            context.stopService(Intent(context, MonitorService::class.java))
        }

        /** Ask a running service to retry the queue now (e.g. after settings changed). */
        fun flushNow(context: Context) {
            if (Prefs(context).monitoringEnabled && hasUsageAccess(context)) {
                context.startForegroundService(Intent(context, MonitorService::class.java).setAction(ACTION_FLUSH))
            }
        }
    }

    private lateinit var worker: HandlerThread
    private lateinit var handler: Handler
    private lateinit var monitor: ForegroundMonitor
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private val pollTask = Runnable { poll() }
    private val flushTask = Runnable { flush() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "Monitoring", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shown while Muse Event Bridge is watching foreground apps"
            }
        )
        goForeground("Starting…")
        worker = HandlerThread("muse-monitor").also { it.start() }
        handler = Handler(worker.looper)
        monitor = ForegroundMonitor(this)
        registerNetworkCallback()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stop(this)
            return START_NOT_STICKY
        }
        // Every startForegroundService() must be answered with startForeground().
        goForeground(statusText())
        if (intent?.action == ACTION_FLUSH) {
            handler.post {
                EventStore.get(this).makePendingDueNow()
                flush()
            }
        } else {
            handler.removeCallbacks(pollTask)
            handler.post(pollTask)
        }
        return START_STICKY
    }

    override fun onDestroy() {
        networkCallback?.let { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) }
        handler.removeCallbacksAndMessages(null)
        worker.quitSafely()
        super.onDestroy()
    }

    private fun poll() {
        val prefs = Prefs(this)
        if (!prefs.monitoringEnabled) {
            stopSelf()
            return
        }
        if (hasUsageAccess(this)) {
            try {
                monitor.poll()
            } catch (e: Exception) {
                Log.e(TAG, "poll failed", e)
            }
        }
        flush()
        updateNotification()
        handler.postDelayed(pollTask, prefs.pollSeconds * 1000L)
    }

    private fun flush() {
        handler.removeCallbacks(flushTask)
        val delay = try {
            EventSender.flush(this)
        } catch (e: Exception) {
            Log.e(TAG, "flush failed", e)
            null
        }
        if (delay != null) handler.postDelayed(flushTask, delay)
        updateNotification()
    }

    private fun registerNetworkCallback() {
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                // Connectivity is back: skip the remaining backoff and retry right away.
                handler.post {
                    EventStore.get(this@MonitorService).makePendingDueNow()
                    flush()
                }
            }
        }
        getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(cb)
        networkCallback = cb
    }

    private fun statusText(): String {
        if (!hasUsageAccess(this)) return "Usage access missing: tap to fix"
        val pending = EventStore.get(this).pendingCount()
        val mode = if (Prefs(this).trackAllApps) "all apps" else "watchlist"
        return if (pending == 0) "Watching $mode" else "Watching $mode · $pending queued"
    }

    private fun updateNotification() {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(statusText()))
    }

    private fun goForeground(text: String) {
        val notification = buildNotification(text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, MonitorService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .addAction(
                Notification.Action.Builder(
                    Icon.createWithResource(this, R.drawable.ic_notification), "Stop", stop
                ).build()
            )
            .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }
}
