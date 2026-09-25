from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np

from smart_scan.env.scan_env import ScanEnvironment, Transition
from smart_scan.schedulers.base import Scheduler, coverage_urgency, revisit_candidate_mask

try:
    import torch
    from torch import nn
except ImportError:  # pragma: no cover - exercised when optional dependency is absent
    torch = None
    nn = None


class QNetwork(nn.Module if nn is not None else object):  # type: ignore[misc]
    def __init__(self, state_size: int, num_actions: int, hidden_size: int = 128) -> None:
        if nn is None:
            raise RuntimeError("Install the ml dependency group to use DQN")
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(state_size, hidden_size),
            nn.ReLU(),
            nn.Linear(hidden_size, hidden_size),
            nn.ReLU(),
            nn.Linear(hidden_size, num_actions),
        )

    def forward(self, state):  # type: ignore[no-untyped-def]
        return self.network(state)


class DQNScheduler(Scheduler):
    name = "dqn"

    def __init__(
        self,
        *,
        hidden_size: int = 128,
        replay_capacity: int = 50_000,
        batch_size: int = 64,
        gamma: float = 0.95,
        learning_rate: float = 5e-4,
        target_update_steps: int = 250,
        train_frequency: int = 4,
        epsilon_start: float = 1.0,
        epsilon_end: float = 0.05,
        epsilon_decay_steps: int = 10_000,
        training: bool = True,
        device: str = "cpu",
        model_path: str | Path | None = None,
        max_revisit_factor: float | None = 2.0,
        min_revisit_factor: float | None = None,
        uncertainty_weight: float = 0.5,
        coverage_bonus_weight: float = 0.0,
    ) -> None:
        if torch is None:
            raise RuntimeError("PyTorch is required for DQN; install with pip install -e .[ml]")
        self.hidden_size = hidden_size
        self.replay = deque(maxlen=replay_capacity)
        self.batch_size = batch_size
        self.gamma = gamma
        self.learning_rate = learning_rate
        self.target_update_steps = target_update_steps
        self.train_frequency = max(int(train_frequency), 1)
        self.epsilon_start = epsilon_start
        self.epsilon_end = epsilon_end
        self.epsilon_decay_steps = max(epsilon_decay_steps, 1)
        self.training = training
        self.device = torch.device(device)
        self.model_path = Path(model_path) if model_path is not None else None
        self.model_loaded = False
        self.max_revisit_factor = max_revisit_factor
        self.min_revisit_factor = min_revisit_factor
        self.uncertainty_weight = uncertainty_weight
        self.coverage_bonus_weight = coverage_bonus_weight
        self.online: QNetwork | None = None
        self.target: QNetwork | None = None
        self.optimizer = None
        self.action_steps = 0
        self.gradient_steps = 0
        self.loss_history: list[float] = []

    @property
    def epsilon(self) -> float:
        if not self.training:
            return 0.0
        fraction = min(self.action_steps / self.epsilon_decay_steps, 1.0)
        return self.epsilon_start + fraction * (self.epsilon_end - self.epsilon_start)

    def reset(self, env: ScanEnvironment, seed: int = 0) -> None:
        super().reset(env, seed)
        torch.manual_seed(seed)
        if self.online is None:
            self.online = QNetwork(env.state_size, env.episode.num_bands, self.hidden_size).to(self.device)
            self.target = QNetwork(env.state_size, env.episode.num_bands, self.hidden_size).to(self.device)
            self.target.load_state_dict(self.online.state_dict())
            self.target.eval()
            self.optimizer = torch.optim.Adam(self.online.parameters(), lr=self.learning_rate)
        elif self.online.network[-1].out_features != env.episode.num_bands:
            raise ValueError("all DQN episodes must use the same number of receiver bands")
        if self.model_path is not None and not self.model_loaded:
            self.load(self.model_path)
            self.model_loaded = True

    def select_action(self, env: ScanEnvironment) -> int:
        if self.online is None:
            raise RuntimeError("reset the DQN scheduler before selecting actions")
        candidate_mask = revisit_candidate_mask(
            env,
            self.max_revisit_factor,
            min_revisit_factor=self.min_revisit_factor,
            uncertainty_weight=self.uncertainty_weight,
        )
        candidates = (
            np.flatnonzero(candidate_mask)
            if candidate_mask is not None
            else np.arange(env.episode.num_bands)
        )
        if self.rng.random() < self.epsilon:
            action = int(self.rng.choice(candidates))
        else:
            state = torch.as_tensor(env.state_vector(), dtype=torch.float32, device=self.device).unsqueeze(0)
            with torch.no_grad():
                values = self.online(state).squeeze(0)
                urgency = torch.as_tensor(
                    coverage_urgency(
                        env,
                        self.max_revisit_factor,
                        min_revisit_factor=self.min_revisit_factor,
                        uncertainty_weight=self.uncertainty_weight,
                    ),
                    dtype=torch.float32,
                    device=self.device,
                )
                values = values + self.coverage_bonus_weight * urgency
                if candidate_mask is not None:
                    invalid = torch.as_tensor(~candidate_mask, dtype=torch.bool, device=self.device)
                    values = values.masked_fill(invalid, -torch.inf)
                action = int(values.argmax().item())
        self.action_steps += 1
        return action

    def observe(
        self,
        env: ScanEnvironment,
        state: np.ndarray,
        action: int,
        transition: Transition,
        next_state: np.ndarray,
    ) -> None:
        if not self.training:
            return
        self.replay.append(
            (
                np.asarray(state, dtype=np.float32),
                int(action),
                float(transition.reward),
                np.asarray(next_state, dtype=np.float32),
                bool(transition.done),
                (
                    revisit_candidate_mask(
                        env,
                        self.max_revisit_factor,
                        min_revisit_factor=self.min_revisit_factor,
                        uncertainty_weight=self.uncertainty_weight,
                    )
                    if not transition.done
                    else np.ones(env.episode.num_bands, dtype=bool)
                ),
            )
        )
        if len(self.replay) >= self.batch_size and self.action_steps % self.train_frequency == 0:
            self._train_batch()

    def _train_batch(self) -> float:
        if self.online is None or self.target is None or self.optimizer is None:
            raise RuntimeError("DQN has not been initialized")
        indices = self.rng.choice(len(self.replay), size=self.batch_size, replace=False)
        samples = [self.replay[int(index)] for index in indices]
        states = torch.as_tensor(
            np.stack([sample[0] for sample in samples]), dtype=torch.float32, device=self.device
        )
        actions = torch.as_tensor(
            [sample[1] for sample in samples], dtype=torch.int64, device=self.device
        ).unsqueeze(1)
        rewards = torch.as_tensor(
            [sample[2] for sample in samples], dtype=torch.float32, device=self.device
        )
        next_states = torch.as_tensor(
            np.stack([sample[3] for sample in samples]), dtype=torch.float32, device=self.device
        )
        dones = torch.as_tensor(
            [sample[4] for sample in samples], dtype=torch.float32, device=self.device
        )
        next_masks = torch.as_tensor(
            np.stack(
                [
                    sample[5]
                    if sample[5] is not None
                    else np.ones(self.online.network[-1].out_features, dtype=bool)
                    for sample in samples
                ]
            ),
            dtype=torch.bool,
            device=self.device,
        )

        predicted = self.online(states).gather(1, actions).squeeze(1)
        with torch.no_grad():
            next_values = self.target(next_states).masked_fill(~next_masks, -torch.inf)
            target = rewards + self.gamma * (1.0 - dones) * next_values.max(dim=1).values
        loss = torch.nn.functional.smooth_l1_loss(predicted, target)
        self.optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.online.parameters(), max_norm=10.0)
        self.optimizer.step()
        self.gradient_steps += 1
        if self.gradient_steps % self.target_update_steps == 0:
            self.target.load_state_dict(self.online.state_dict())
        value = float(loss.item())
        self.loss_history.append(value)
        return value

    def save(self, path: str | Path) -> Path:
        if self.online is None:
            raise RuntimeError("cannot save an uninitialized DQN")
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        torch.save(
            {
                "state_dict": self.online.state_dict(),
                "hidden_size": self.hidden_size,
                "state_size": self.online.network[0].in_features,
                "num_actions": self.online.network[-1].out_features,
                "action_steps": self.action_steps,
                "gradient_steps": self.gradient_steps,
            },
            target,
        )
        return target

    def load(self, path: str | Path) -> None:
        if self.online is None or self.target is None:
            raise RuntimeError("reset the DQN against an environment before loading weights")
        payload = torch.load(path, map_location=self.device, weights_only=True)
        self.online.load_state_dict(payload["state_dict"])
        self.target.load_state_dict(self.online.state_dict())
        self.action_steps = int(payload.get("action_steps", 0))
        self.gradient_steps = int(payload.get("gradient_steps", 0))
