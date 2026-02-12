import { useEffect, useState } from "react";
import "./ScheduledBehaviors.scss";

interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  nextRun: number;
  isActive: boolean;
  icon: string;
}

const tasks: ScheduledTask[] = [
  {
    id: "1",
    name: "Light Toggle",
    cron: "0 */3 * * *",
    nextRun: 15,
    isActive: false,
    icon: "💡",
  },
  {
    id: "2",
    name: "Ring Alarm",
    cron: "0 8 * * *",
    nextRun: 42,
    isActive: false,
    icon: "🔔",
  },
];

export function ScheduledBehaviors() {
  const [currentTime, setCurrentTime] = useState(0);
  const [scheduledTasks, setScheduledTasks] = useState(tasks);
  const [lastTriggered, setLastTriggered] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime((prev) => {
        const newTime = prev + 1;

        // Check if any tasks should trigger
        setScheduledTasks((prevTasks) =>
          prevTasks.map((task) => {
            if (newTime >= task.nextRun && !task.isActive) {
              setLastTriggered(task.id);
              return {
                ...task,
                isActive: true,
                nextRun: newTime + Math.floor(Math.random() * 30) + 20, // Random next run
              };
            } else if (task.isActive && newTime > task.nextRun - 18) {
              return { ...task, isActive: false };
            }
            return task;
          })
        );

        return newTime;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Clear last triggered after animation
  useEffect(() => {
    if (lastTriggered) {
      const timeout = setTimeout(() => setLastTriggered(null), 2000);
      return () => clearTimeout(timeout);
    }
  }, [lastTriggered]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  return (
    <div className="scheduled-behaviors">
      <div className="clock-section">
        <div className="main-clock">
          <div className="clock-face">
            <div className="clock-time">{formatTime(currentTime)}</div>
          </div>
          <div
            className={`clock-pulse ${lastTriggered ? "triggered" : ""}`}
          ></div>
        </div>
      </div>

      <div className="tasks-section">
        <div className="tasks-list">
          {scheduledTasks.map((task) => {
            const timeUntil = Math.max(0, task.nextRun - currentTime);
            const isAboutToTrigger = timeUntil <= 3 && timeUntil > 0;
            const isTriggering = lastTriggered === task.id;

            return (
              <div
                key={task.id}
                className={`task-item ${task.isActive ? "active" : ""} ${
                  isAboutToTrigger ? "pending" : ""
                } ${isTriggering ? "triggering" : ""}`}
              >
                <div className="task-icon">{task.icon}</div>
                <div className="task-info">
                  <div className="task-name">{task.name}</div>
                  <div className="task-cron">{task.cron}</div>
                </div>
                <div className="task-timer">
                  <div className="next-run">
                    {task.isActive ? "RUNNING" : `${timeUntil}s`}
                  </div>
                  {isAboutToTrigger && (
                    <div className="countdown-animation">
                      <div className="countdown-dot"></div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
