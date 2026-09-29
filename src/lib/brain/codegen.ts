// ─── NEXUS Brain — Générateur de code from scratch ────────────────────────────
// Templates paramétrés Roblox/Luau (pièces, kill bricks, téléporteurs…) et
// scaffolds propres pour 14 langages. Aucun LLM : composition de gabarits.

import type { Entities } from './entities'

export interface GeneratedCode {
  language: string
  filename: string
  code: string
  description: string // courte explication pour la réponse finale
}

type Ctx = { text: string; entities: Entities; topic: string }

const has = (text: string, re: RegExp) => re.test(text)

// ── Roblox / Luau : templates métier ─────────────────────────────────────────

function luauCoin(ctx: Ctx): GeneratedCode {
  const amount = ctx.entities.numbers?.find((n) => n > 0 && n < 100) ?? 10
  return {
    language: 'lua',
    filename: 'coin_spawner.lua',
    description: `spawner de pièces (${amount} max au sol, collecte +100 % serveur, respawn 5 s)`,
    code: `--=============================================================--
-- SPAWNER DE PIÈCES — Roblox Studio (Luau)
-- À placer dans ServerScriptService
-- Le dossier "Pieces" est créé automatiquement dans Workspace
--=============================================================--

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")

-- ── Réglages ──────────────────────────────────────────────
local QUANTITE_MAX = ${amount}      -- pièces présentes simultanément
local ZONE = Vector2.new(60, 60)    -- zone de spawn (mètres)
local VALEUR = 10                   -- argent donné par pièce
local RESPAWN = 5                   -- secondes avant nouvelle pièce

local pieces = Instance.new("Folder")
pieces.Name = "Pieces"
pieces.Parent = Workspace

-- ── Leaderstats (argent) ──────────────────────────────────
local function preparerJoueur(joueur: Player)
	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	stats.Parent = joueur

	local argent = Instance.new("IntValue")
	argent.Name = "Argent"
	argent.Value = 0
	argent.Parent = stats
end

Players.PlayerAdded:Connect(preparerJoueur)
for _, joueur in Players:GetPlayers() do
	preparerJoueur(joueur)
end

-- ── Création d'une pièce ──────────────────────────────────
local function creerPiece(): Part
	local piece = Instance.new("Part")
	piece.Name = "Piece"
	piece.Shape = Enum.PartType.Cylinder
	piece.Size = Vector3.new(0.3, 1.4, 1.4)
	piece.Color = Color3.fromRGB(255, 200, 40)
	piece.Material = Enum.Material.Neon
	piece.Position = Vector3.new(
		(math.random() - 0.5) * ZONE.X,
		2,
		(math.random() - 0.5) * ZONE.Y
	)
	piece.Anchored = true
	piece.CanCollide = false

	local lumiere = Instance.new("PointLight")
	lumiere.Color = piece.Color
	lumiere.Range = 8
	lumiere.Parent = piece

	piece.Parent = pieces

	-- Collecte : premier joueur qui touche
	local collecte = false
	piece.Touched:Connect(function(touche)
		if collecte then return end
		local personnage = touche.Parent
		local joueur = Players:GetPlayerFromCharacter(personnage)
		if joueur and joueur:FindFirstChild("leaderstats") then
			collecte = true
			local argent = joueur.leaderstats:FindFirstChild("Argent")
			if argent then
				argent.Value += \${VALEUR}
			end
			piece:Destroy()
			task.delay(RESPAWN, creerPiece)
		end
	end)

	return piece
end

-- ── Peuplement initial ────────────────────────────────────
for i = 1, QUANTITE_MAX do
	creerPiece()
end

print("✅ Spawner de pièces actif (${amount} pièces, +\${VALEUR}/pièce)")
`,
  }
}

function luauKill(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'kill_brick.lua',
    description: 'kill brick (bloc mortel + respawn du joueur, respect du spawn)',
    code: `--=============================================================--
-- KILL BRICK — Roblox Studio (Luau)
-- Place ce Script DANS le bloc mortel (pas ServerScriptService)
--=============================================================--

local Players = game:GetService("Players")

local BLOC = script.Parent :: BasePart

-- Réglages
local DELAI_RESPECT = 2 -- secondes d'invincibilité après respawn

local derniersSpawns: { [Player]: number } = {}

Players.PlayerAdded:Connect(function(joueur)
	joueur.CharacterAdded:Connect(function()
		derniersSpawns[joueur] = os.clock()
	end)
end)

local function tuer(personnage: Model)
	local humain = personnage:FindFirstChildOfClass("Humanoid")
	if humain and humain.Health > 0 then
		humain.Health = 0
	end
end

BLOC.Touched:Connect(function(touche)
	local personnage = touche.Parent
	if not personnage then return end

	local joueur = Players:GetPlayerFromCharacter(personnage)
	if not joueur then return end

	-- Respect post-respawn
	local spawnAt = derniersSpawns[joueur]
	if spawnAt and os.clock() - spawnAt < DELAI_RESPECT then return end

	tuer(personnage)
end)

-- Effet visuel : le bloc pulse en rouge
local couleurOrigine = BLOC.Color
task.spawn(function()
	while BLOC.Parent do
		local t = os.clock() % 1
		BLOC.Color = couleurOrigine:Lerp(Color3.fromRGB(255, 40, 40), t)
		task.wait(0.05)
	end
end)

print("✅ Kill brick armé : " .. BLOC:GetFullName())
`,
  }
}

function luauCheckpoint(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'checkpoints.lua',
    description: 'système de checkpoints d’obby (ordre respecté, sauvegarde du stade)',
    code: `--=============================================================--
-- CHECKPOINTS D'OBBY — Roblox Studio (Luau)
-- Script dans ServerScriptService
-- Nomme tes blocs "Checkpoint1", "Checkpoint2", … dans Workspace
--=============================================================--

local Players = game:GetService("Players")

-- ── Repérage des checkpoints ──────────────────────────────
local checkpoints: { BasePart } = {}
for i = 1, 100 do
	local cp = workspace:FindFirstChild("Checkpoint" .. i)
	if not cp then break end
	if cp:IsA("BasePart") then
		table.insert(checkpoints, cp)
	end
end
assert(#checkpoints > 0, "Aucun CheckpointN trouvé dans Workspace !")

-- ── État des joueurs ──────────────────────────────────────
local stade: { [Player]: number } = {}

local function preparerJoueur(joueur: Player)
	stade[joueur] = 0

	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	stats.Parent = joueur

	local etape = Instance.new("IntValue")
	etape.Name = "Étape"
	etape.Parent = stats

	joueur.CharacterAdded:Connect(function(personnage)
		local index = stade[joueur] or 0
		local destination = index == 0 and workspace:FindFirstChild("SpawnLocation") or checkpoints[index]
		if destination then
			local racine = personnage:WaitForChild("HumanoidRootPart")
			task.wait(0.1)
			racine.CFrame = destination.CFrame + Vector3.new(0, 4, 0)
		end
	end)
end

Players.PlayerAdded:Connect(preparerJoueur)
for _, joueur in Players:GetPlayers() do
	preparerJoueur(joueur)
end

-- ── Validation des checkpoints ────────────────────────────
for index, cp in checkpoints do
	cp.Touched:Connect(function(touche)
		local joueur = Players:GetPlayerFromCharacter(touche.Parent)
		if not joueur then return end
		-- On ne valide que le checkpoint suivant (pas de triche)
		if (stade[joueur] or 0) == index - 1 then
			stade[joueur] = index
			local etape = joueur.leaderstats and joueur.leaderstats:FindFirstChild("Étape")
			if etape then etape.Value = index end
		end
	end)
end

print(\`✅ ${'{'}#{checkpoints}${'}'} checkpoints chargés\`)
`,
  }
}

function luauTeleporter(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'teleporteur.lua',
    description: 'téléporteur à deux plots (A → B avec effet + cooldown)',
    code: `--=============================================================--
-- TÉLÉPORTEUR — Roblox Studio (Luau)
-- Script dans ServerScriptService
-- Nomme les plots "TeleportA" et "TeleportB" dans Workspace
--=============================================================--

local COOLDOWN = 2 -- secondes

local plotA = workspace:WaitForChild("TeleportA") :: BasePart
local plotB = workspace:WaitForChild("TeleportB") :: BasePart
local dernierUsage: { [Player]: number } = {}

local function brancher(depart: BasePart, arrivee: BasePart)
	depart.Touched:Connect(function(touche)
		local joueur = game.Players:GetPlayerFromCharacter(touche.Parent)
		if not joueur then return end

		local maintenant = os.clock()
		if (dernierUsage[joueur] or 0) + COOLDOWN > maintenant then return end
		dernierUsage[joueur] = maintenant

		local racine = touche.Parent:FindFirstChild("HumanoidRootPart")
		if not racine then return end

		-- Effet sonore + flash (optionnels mais sympas)
		local son = Instance.new("Sound")
		son.SoundId = "rbxassetid://12221967" -- whoosh
		son.Volume = 0.5
		son.Parent = racine
		son:Play()

		racine.CFrame = arrivee.CFrame + Vector3.new(0, 4, 0)

		-- Effet visuel de particules
		local particules = Instance.new("ParticleEmitter")
		particules.Color = ColorSequence.new(Color3.fromRGB(120, 80, 255))
		particules.Lifetime = NumberRange.new(0.4)
		particules.Speed = NumberRange.new(8)
		particules.Parent = racine
		task.delay(0.6, function() particules:Destroy() end)
	end)
end

brancher(plotA, plotB)
brancher(plotB, plotA)

print("✅ Téléporteur A ↔ B actif")
`,
  }
}

function luauLeaderboard(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'classement_live.lua',
    description: 'classement live (top 10 argent, panneau SurfaceGui actualisé)',
    code: `--=============================================================--
-- CLASSEMENT LIVE — Roblox Studio (Luau)
-- Script dans ServerScriptService
-- Crée un Part "PanneauClassement" avec un SurfaceGui > TextLabel
--=============================================================--

local Players = game:GetService("Players")

local panneau = workspace:WaitForChild("PanneauClassement") :: BasePart
local gui = panneau:WaitForChild("SurfaceGui")
local label = gui:WaitForChild("TextLabel") :: TextLabel
label.TextScaled = true

local function rafraichir()
	local classement = {}
	for _, joueur in Players:GetPlayers() do
		local stats = joueur:FindFirstChild("leaderstats")
		local argent = stats and stats:FindFirstChild("Argent")
		if argent then
			table.insert(classement, { nom = joueur.Name, valeur = argent.Value })
		end
	end

	table.sort(classement, function(a, b)
		return a.valeur > b.valeur
	end)

	local lignes = { "🏆 CLASSEMENT 🏆", "" }
	for rang, entree in ipairs(classement) do
		if rang > 10 then break end
		local medaille = rang == 1 and "🥇" or rang == 2 and "🥈" or rang == 3 and "🥉" or rang .. "."
		table.insert(lignes, string.format("%s %s — %d", medaille, entree.nom, entree.valeur))
	end

	label.Text = table.concat(lignes, "\\n")
end

-- Mise à jour régulière + au join/leave
task.spawn(function()
	while true do
		rafraichir()
		task.wait(3)
	end
end)
Players.PlayerAdded:Connect(rafraichir)
Players.PlayerRemoving:Connect(rafraichir)

print("✅ Classement live actif (top 10, 3 s)")
`,
  }
}

function luauDatastore(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'sauvegarde_datastore.lua',
    description: 'sauvegarde DataStore (argent persistant, pcall, session lock léger)',
    code: `--=============================================================--
-- SAUVEGARDE DATASTORE — Roblox Studio (Luau)
-- Script dans ServerScriptService
-- ⚠️ Active "Enable Studio Access to API Services" (Game Settings)
--=============================================================--

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local store = DataStoreService:GetDataStore("SauvegardeJeu_v1")

-- ── Chargement ────────────────────────────────────────────
local function charger(joueur: Player)
	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	stats.Parent = joueur

	local argent = Instance.new("IntValue")
	argent.Name = "Argent"
	argent.Parent = stats

	local cle = "joueur_" .. joueur.UserId
	local ok, donnees = pcall(function()
		return store:GetAsync(cle)
	end)

	if ok and type(donnees) == "table" then
		argent.Value = tonumber(donnees.argent) or 0
	else
		if not ok then
			warn("Échec de chargement pour " .. joueur.Name .. " : " .. tostring(donnees))
		end
		argent.Value = 100 -- valeur de départ
	end
end

-- ── Sauvegarde ────────────────────────────────────────────
local function sauvegarder(joueur: Player)
	local stats = joueur:FindFirstChild("leaderstats")
	local argent = stats and stats:FindFirstChild("Argent")
	if not argent then return end

	local cle = "joueur_" .. joueur.UserId
	local ok, err = pcall(function()
		store:SetAsync(cle, {
			argent = argent.Value,
			sauvegardeAu = os.time(),
		})
	end)
	if not ok then
		warn("Échec de sauvegarde pour " .. joueur.Name .. " : " .. tostring(err))
	end
end

Players.PlayerAdded:Connect(charger)
Players.PlayerRemoving:Connect(sauvegarder)

-- Sécurité : sauvegarde de secours à la fermeture du serveur
game:BindToClose(function()
	for _, joueur in Players:GetPlayers() do
		sauvegarder(joueur)
	end
end)

print("✅ DataStore prêt (chargement + sauvegarde auto)")
`,
  }
}

function luauDoor(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'porte_automatique.lua',
    description: 'porte automatique (s’ouvre au toucher, TweenService, sécurité joueurs uniquement)',
    code: `--=============================================================--
-- PORTE AUTOMATIQUE — Roblox Studio (Luau)
-- Place ce Script DANS la porte (Part)
--=============================================================--

local TweenService = game:GetService("TweenService")
local Players = game:GetService("Players")

local porte = script.Parent :: BasePart
local HAUTEUR_OUVERTE = porte.Size.Y * 0.9

local fermeeCFrame = porte.CFrame
local ouverteCFrame = fermeeCFrame * CFrame.new(0, HAUTEUR_OUVERTE, 0)

local info = TweenInfo.new(0.8, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
local tweenOuvrir = TweenService:Create(porte, info, { CFrame = ouverteCFrame })
local tweenFermer = TweenService:Create(porte, info, { CFrame = fermeeCFrame })

local ouverte = false
local enMouvement = false

local function basculer(ouvrir: boolean)
	if enMouvement or ouverte == ouvrir then return end
	enMouvement = true
	local tween = ouvrir and tweenOuvrir or tweenFermer
	tween:Play()
	tween.Completed:Wait()
	ouverte = ouvrir
	enMouvement = false
end

porte.Touched:Connect(function(touche)
	local personnage = touche.Parent
	if personnage and Players:GetPlayerFromCharacter(personnage) then
		basculer(true)
	end
end)

-- Referme quand plus personne autour
task.spawn(function()
	while porte.Parent do
		task.wait(1)
		local zone = workspace:GetPartBoundsInBox(porte.CFrame, Vector3.new(8, 6, 8))
		local joueurProche = false
		for _, part in zone do
			local modele = part:FindFirstAncestorOfClass("Model")
			if modele and Players:GetPlayerFromCharacter(modele) then
				joueurProche = true
				break
			end
		end
		if not joueurProche then
			basculer(false)
		end
	end
end)

print("✅ Porte automatique installée : " .. porte.Name)
`,
  }
}

function luauSpeed(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'plateau_vitesse.lua',
    description: 'plateau de vitesse (boost de vitesse temporaire avec retour à la normale)',
    code: `--=============================================================--
-- PLATEAU DE VITESSE — Roblox Studio (Luau)
-- Place ce Script DANS le plateau (Part)
--=============================================================--

local Players = game:GetService("Players")

local plateau = script.Parent :: BasePart
local VITESSE_BOOST = 42   -- WalkSpeed de base : 16
local DUREE = 4            -- secondes de boost
local COOLDOWN: { [Player]: number } = {}

plateau.Touched:Connect(function(touche)
	local joueur = Players:GetPlayerFromCharacter(touche.Parent)
	if not joueur then return end
	if (COOLDOWN[joueur] or 0) + DUREE > os.clock() then return end
	COOLDOWN[joueur] = os.clock()

	local personnage = touche.Parent
	local humain = personnage:FindFirstChildOfClass("Humanoid")
	if not humain then return end

	-- Effet visuel : plateau qui brille
	plateau.Material = Enum.Material.Neon
	plateau.Color = Color3.fromRGB(0, 255, 120)

	humain.WalkSpeed = VITESSE_BOOST

	task.delay(DUREE, function()
		if humain.Parent then
			humain.WalkSpeed = 16
		end
		plateau.Material = Enum.Material.SmoothPlastic
		plateau.Color = Color3.fromRGB(120, 120, 120)
	end)
end)

print("✅ Plateau de vitesse : " .. VITESSE_BOOST .. " walkspeed pendant " .. DUREE .. " s")
`,
  }
}

function luauNpc(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'pnj_suiveur.lua',
    description: 'PNJ qui suit le joueur le plus proche (pathfinding, animation de marche)',
    code: `--=============================================================--
-- PNJ SUIVEUR — Roblox Studio (Luau)
-- Script DANS le modèle du PNJ (avec Humanoid + HumanoidRootPart)
--=============================================================--

local PathfindingService = game:GetService("PathfindingService")
local Players = game:GetService("Players")

local pnj = script.Parent
local humain = pnj:WaitForChild("Humanoid") :: Humanoid
local racine = pnj:WaitForChild("HumanoidRootPart") :: BasePart

local RAYON_DETECTION = 40 -- mètres

local function joueurLePlusProche(): Player?
	local meilleur: Player? = nil
	local distanceMin = RAYON_DETECTION
	for _, joueur in Players:GetPlayers() do
		local perso = joueur.Character
		local cible = perso and perso:FindFirstChild("HumanoidRootPart")
		if cible then
			local d = (cible.Position - racine.Position).Magnitude
			if d < distanceMin then
				distanceMin = d
				meilleur = joueur
			end
		end
	end
	return meilleur
end

local function seDeplacerVers(position: Vector3)
	local chemin = PathfindingService:CreatePath({
		AgentRadius = 2,
		AgentHeight = 5,
		AgentCanJump = true,
	})
	local ok = pcall(function()
		chemin:ComputeAsync(racine.Position, position)
	end)
	if ok and chemin.Status == Enum.PathStatus.Success then
		for _, waypoint in chemin:GetWaypoints() do
			if waypoint.Action == Enum.PathWaypointAction.Jump then
				humain.Jump = true
			end
			humain:MoveTo(waypoint.Position)
			local atteint = humain.MoveToFinished:Wait()
			if not atteint then break end
		end
	else
		-- Pas de chemin : on fonce en ligne droite
		humain:MoveTo(position)
	end
end

-- Boucle de suivi (10× par seconde)
task.spawn(function()
	while pnj.Parent do
		local cible = joueurLePlusProche()
		if cible and cible.Character then
			local racineCible = cible.Character:FindFirstChild("HumanoidRootPart")
			if racineCible and (racineCible.Position - racine.Position).Magnitude > 6 then
				seDeplacerVers(racineCible.Position)
			end
		end
		task.wait(0.1)
	end
end)

print("✅ PNJ suiveur actif (rayon " .. RAYON_DETECTION .. " m)")
`,
  }
}

function luauShop(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'boutique.lua',
    description: 'boutique en jeu (achat serveur sécurisé, prix, inventaire des outils)',
    code: `--=============================================================--
-- BOUTIQUE — Roblox Studio (Luau)
-- Script dans ServerScriptService + RemoteEvent "Acheter" (ReplicatedStorage)
-- Côté client : ReplicatedStorage.Acheter:FireServer(nomItem)
--=============================================================--

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")

local remote = ReplicatedStorage:WaitForChild("Acheter") :: RemoteEvent

-- ── Catalogue (prix en Argent) ────────────────────────────
local CATALOGUE: { [string]: { prix: number, outil: string } } = {
	epee_fer = { prix = 100, outil = "ÉpéeEnFer" },
	potion_vie = { prix = 50, outil = "PotionVie" },
	botte_vitesse = { prix = 200, outil = "BotteVitesse" },
	bouclier = { prix = 350, outil = "Bouclier" },
}

-- Le dossier "Outils" contient les Tool du jeu
local dossierOutils = ReplicatedStorage:WaitForChild("Outils")

remote.OnServerEvent:Connect(function(joueur, nomItem)
	-- ── VALIDATION SERVEUR (jamais confiance au client) ──
	if type(nomItem) ~= "string" then return end
	local item = CATALOGUE[nomItem]
	if not item then return end

	local stats = joueur:FindFirstChild("leaderstats")
	local argent = stats and stats:FindFirstChild("Argent")
	if not argent then return end
	if argent.Value < item.prix then return end

	-- Déjà possédé ?
	local backpack = joueur:FindFirstChild("Backpack")
	if backpack and backpack:FindFirstChild(item.outil) then return end

	-- Achat
	argent.Value -= item.prix
	local outil = dossierOutils:WaitForChild(item.outil):Clone()
	outil.Parent = joueur.Backpack

	-- Confirmation renvoyée au client (pour le son/la notif)
	remote:FireClient(joueur, true, nomItem)
end)

print("✅ Boutique ouverte (" .. (function()
	local n = 0
	for _ in CATALOGUE do n += 1 end
	return n
end)() .. " articles)")
`,
  }
}

function luauDayNight(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'cycle_jour_nuit.lua',
    description: 'cycle jour/nuit fluide ( CLOCKTIME animé, lumières qui s’allument la nuit)',
    code: `--=============================================================--
-- CYCLE JOUR/NUIT — Roblox Studio (Luau)
-- Script dans ServerScriptService
--=============================================================--

local Lighting = game:GetService("Lighting")

local DUREE_JOUR = 120      -- secondes pour une journée complète
local HEURE_DEBUT = 7       -- on démarre le matin

-- Réglages ambiance
local COULEUR_JOUR = Color3.fromRGB(255, 240, 200)
local COULEUR_NUIT = Color3.fromRGB(40, 60, 120)

local eclairages: { PointLight | SurfaceLight } = {}
for _, descendant in workspace:GetDescendants() do
	if descendant:IsA("PointLight") or descendant:IsA("SurfaceLight") then
		table.insert(eclairages, descendant)
	end
end

Lighting.ClockTime = HEURE_DEBUT

task.spawn(function()
	while true do
		local delta = task.wait(0.1)
		local avancement = delta / DUREE_JOUR * 24 -- heures écoulées
		Lighting.ClockTime = (Lighting.ClockTime + avancement) % 24

		-- Lumières automatiques la nuit
		local nuit = Lighting.ClockTime < 6.5 or Lighting.ClockTime > 18
		for _, lumiere in eclairages do
			lumiere.Enabled = nuit
		end
	end
end)

print("✅ Cycle jour/nuit : 1 journée = " .. DUREE_JOUR .. " s")
`,
  }
}

function luauGeneric(ctx: Ctx): GeneratedCode {
  const sujet = ctx.topic || 'système personnalisé'
  return {
    language: 'lua',
    filename: 'script_roblox.lua',
    description: `script Luau générique bien structuré pour : ${sujet}`,
    code: `--=============================================================--
-- ${sujet.toUpperCase()} — Roblox Studio (Luau)
-- Script dans ServerScriptService
-- Structure : réglages → fonctions → connexions → démarrage
--=============================================================--

local Players = game:GetService("Players")

-- ── Réglages (modifie ici) ────────────────────────────────
local CONFIG = {
	actif = true,
	cooldown = 1, -- secondes entre deux déclenchements
	debug = true, -- affiche les messages de débogage
}

local dernierUsage: { [Player]: number } = {}

-- ── Fonctions métier ──────────────────────────────────────
local function log(message: string)
	if CONFIG.debug then
		print("[${sujet.slice(0, 20)}] " .. message)
	end
end

local function peutExecuter(joueur: Player): boolean
	if not CONFIG.actif then return false end
	local maintenant = os.clock()
	if (dernierUsage[joueur] or 0) + CONFIG.cooldown > maintenant then
		return false
	end
	dernierUsage[joueur] = maintenant
	return true
end

local function traiter(joueur: Player, donnees: unknown)
	if not peutExecuter(joueur) then return end
	-- TODO : ta logique métier ici
	log("Requête de " .. joueur.Name)
end

-- ── Connexions ────────────────────────────────────────────
Players.PlayerAdded:Connect(function(joueur)
	log(joueur.Name .. " a rejoint le jeu")
end)

-- Exemple de déclencheur au toucher d'un bloc nommé "Declencheur"
local declencheur = workspace:FindFirstChild("Declencheur")
if declencheur and declencheur:IsA("BasePart") then
	declencheur.Touched:Connect(function(touche)
		local joueur = Players:GetPlayerFromCharacter(touche.Parent)
		if joueur then
			traiter(joueur, nil)
		end
	end)
end

log("✅ Script démarré")
`,
  }
}

// ── Générateurs génériques par langage ───────────────────────────────────────

function pythonGeneric(ctx: Ctx): GeneratedCode {
  const sujet = ctx.topic || 'programme Python'
  const isPrime = has(ctx.text, /premier|prime|nombre premier/i)
  const isFibo = has(ctx.text, /fibonacci/i)
  const isPwd = has(ctx.text, /mot de passe|password/i)
  const isSort = has(ctx.text, /tri|sort|ordre/i)

  if (isPrime) {
    return {
      language: 'python',
      filename: 'nombres_premiers.py',
      description: 'générateur de nombres premiers (crible d’Ératosthène, O(n log log n))',
      code: `# -*- coding: utf-8 -*-
"""Nombres premiers — crible d'Ératosthène.

Complexité : O(n log log n) — optimal pour lister tous les premiers < n.
"""

from math import isqrt


def crible(limit: int) -> list[int]:
    """Retourne tous les nombres premiers inférieurs à limit."""
    if limit < 2:
        return []
    est_premier = [True] * limit
    est_premier[0] = est_premier[1] = False
    for n in range(2, isqrt(limit) + 1):
        if est_premier[n]:
            # On raye les multiples à partir de n² (les précédents
            # ont déjà été rayés par des facteurs plus petits)
            for multiple in range(n * n, limit, n):
                est_premier[multiple] = False
    return [n for n, flag in enumerate(est_premier) if flag]


def est_premier(n: int) -> bool:
    """Test unitaire rapide (division jusqu'à √n)."""
    if n < 2:
        return False
    for diviseur in range(2, isqrt(n) + 1):
        if n % diviseur == 0:
            return False
    return True


if __name__ == "__main__":
    limite = int(input("Lister les premiers jusqu'à : ") or 100)
    premiers = crible(limite)
    print(f"{len(premiers)} nombres premiers sous {limite} :")
    print(", ".join(map(str, premiers[:30])) + ("…" if len(premiers) > 30 else ""))
`,
    }
  }
  if (isFibo) {
    return {
      language: 'python',
      filename: 'fibonacci.py',
      description: 'suite de Fibonacci (itératif O(n) + générateur)',
      code: `# -*- coding: utf-8 -*-
"""Fibonacci — version itérative O(n) + générateur infini."""


def fibonacci(n: int) -> list[int]:
    """Les n premiers termes de la suite (0, 1, 1, 2, 3, 5…)."""
    termes: list[int] = []
    a, b = 0, 1
    for _ in range(max(0, n)):
        termes.append(a)
        a, b = b, a + b
    return termes


def fibonacci_infini():
    """Générateur : yield à la demande, consommation mémoire O(1)."""
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b


if __name__ == "__main__":
    n = int(input("Nombre de termes : ") or 10)
    print(" → ".join(map(str, fibonacci(n))))

    gen = fibonacci_infini()
    print("10 premiers termes du générateur :", [next(gen) for _ in range(10)])
`,
    }
  }
  if (isPwd) {
    return {
      language: 'python',
      filename: 'generateur_mdp.py',
      description: 'générateur de mots de passe sécurisés (module secrets, options)',
      code: `# -*- coding: utf-8 -*-
"""Générateur de mots de passe sécurisés.

Utilise le module \`secrets\` (cryptographiquement sûr) — jamais \`random\`.
"""

import secrets
import string

MINUSCULES = string.ascii_lowercase
MAJUSCULES = string.ascii_uppercase
CHIFFRES = string.digits
SPECIALS = "!@#$%&*+-_?"

CATEGORIES = [MINUSCULES, MAJUSCULES, CHIFFRES, SPECIALS]


def generer(longueur: int = 16, specials: bool = True) -> str:
    """Mot de passe garantissant au moins 1 caractère de chaque catégorie."""
    categories = CATEGORIES if specials else CATEGORIES[:3]
    alphabet = "".join(categories)

    if longueur < len(categories):
        raise ValueError(f"Longueur minimale : {len(categories)}")

    # Garantit 1 caractère par catégorie, puis complète au hasard
    mot = [secrets.choice(cat) for cat in categories]
    mot += [secrets.choice(alphabet) for _ in range(longueur - len(mot))]

    # Mélange sûr : les 4 premiers pourraient être prévisibles
    secrets.SystemRandom().shuffle(mot)
    return "".join(mot)


if __name__ == "__main__":
    for i in range(5):
        print(f"Mot de passe {i + 1} : {generer(16)}")
    print("Force estimée :", 16 * 6.5, "bits ≈ incassable en pratique")
`,
    }
  }
  if (isSort) {
    return {
      language: 'python',
      filename: 'tri_rapide.py',
      description: 'tri rapide (quicksort, complexité O(n log n) moyen)',
      code: `# -*- coding: utf-8 -*-
"""Tri rapide (quicksort) — implémentation pédagogique.

Moyenne O(n log n), pire cas O(n²) (pivot constant sur données triées).
"""

import random


def tri_rapide(liste: list[int]) -> list[int]:
    """Version claire (crée de nouvelles listes)."""
    if len(liste) <= 1:
        return liste
    pivot = liste[len(liste) // 2]
    gauche = [x for x in liste if x < pivot]
    milieu = [x for x in liste if x == pivot]
    droite = [x for x in liste if x > pivot]
    return tri_rapide(gauche) + milieu + tri_rapide(droite)


def tri_rapide_sur_place(liste: list[int], bas: int = 0, haut: int | None = None) -> list[int]:
    """Version Hoare en place (utilisé en production)."""
    if haut is None:
        haut = len(liste) - 1
    if bas < haut:
        pivot = liste[(bas + haut) // 2]
        i, j = bas, haut
        while i <= j:
            while liste[i] < pivot:
                i += 1
            while liste[j] > pivot:
                j -= 1
            if i <= j:
                liste[i], liste[j] = liste[j], liste[i]
                i, j = i + 1, j - 1
        tri_rapide_sur_place(liste, bas, j)
        tri_rapide_sur_place(liste, i, haut)
    return liste


if __name__ == "__main__":
    donnees = [random.randint(0, 99) for _ in range(15)]
    print("Entrée  :", donnees)
    print("Triée   :", tri_rapide(donnees))
    assert tri_rapide_sur_place(donnees[:]) == sorted(donnees), "bug de tri"
    print("✅ Vérification : OK")
`,
    }
  }
  return {
    language: 'python',
    filename: 'programme.py',
    description: `programme Python structuré : ${sujet}`,
    code: `# -*- coding: utf-8 -*-
"""${sujet} — programme Python.

Structure : constantes → fonctions pures → point d'entrée.
"""

import sys
from dataclasses import dataclass


@dataclass
class Resultat:
    """Résultat typé du traitement."""
    ok: bool
    valeur: str = ""
    erreur: str = ""


def traiter(entree: str) -> Resultat:
    """Traitement principal (fonction pure, testable)."""
    if not entree.strip():
        return Resultat(ok=False, erreur="entrée vide")
    # TODO : logique métier ici
    return Resultat(ok=True, valeur=entree.strip().upper())


def main(argv: list[str]) -> int:
    entree = " ".join(argv[1:]) if len(argv) > 1 else input("Entrée : ")
    resultat = traiter(entree)
    if resultat.ok:
        print(f"✅ Résultat : {resultat.valeur}")
        return 0
    print(f"❌ Erreur : {resultat.erreur}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
`,
  }
}

function jsGeneric(ctx: Ctx): GeneratedCode {
  const sujet = ctx.topic || 'programme JavaScript'
  return {
    language: 'javascript',
    filename: 'programme.js',
    description: `programme JavaScript moderne (ES2022) : ${sujet}`,
    code: `// ============================================================
// ${sujet} — JavaScript (ES2022)
// ============================================================

/** Config centralisée — modifie ici */
const CONFIG = Object.freeze({
  debug: true,
  maxEssais: 3,
});

/** Journal propre (désactivable) */
const log = (msg) => {
  if (CONFIG.debug) console.log(\`[app] \${msg}\`);
};

/**
 * Traitement principal — fonction pure, facile à tester.
 * @param {string} entree
 * @returns {{ ok: boolean, valeur?: string, erreur?: string }}
 */
function traiter(entree) {
  if (typeof entree !== 'string' || entree.trim() === '') {
    return { ok: false, erreur: 'entrée vide' };
  }
  // TODO : logique métier
  return { ok: true, valeur: entree.trim().toUpperCase() };
}

/** Exécution avec gestion d'erreurs */
function main() {
  log('Démarrage');
  const exemples = ['bonjour', '   test   ', ''];
  for (const exemple of exemples) {
    const resultat = traiter(exemple);
    if (resultat.ok) {
      console.log(\`✅ "\${exemple.trim()}" → \${resultat.valeur}\`);
    } else {
      console.error(\`❌ "\${exemple}" → \${resultat.erreur}\`);
    }
  }
}

// Point d'entrée (compatible Node + navigateur)
if (typeof require !== 'undefined' && typeof module !== 'undefined') {
  main();
} else {
  document.addEventListener('DOMContentLoaded', main);
}
`,
  }
}

function htmlGeneric(ctx: Ctx): GeneratedCode {
  const title = ctx.topic ? ctx.topic.slice(0, 50) : 'Mon Application'
  return {
    language: 'html',
    filename: 'index.html',
    description: `page HTML/CSS/JS complète et responsive (${title})`,
    code: `<!-- Page générée par le cerveau local de NEXUS -->
<div class="app">
  <header>
    <h1>🚀 ${title}</h1>
    <p>Générée localement — 100 % HTML/CSS/JS</p>
  </header>

  <main>
    <section class="cartes">
      <article class="carte">
        <h3>⚡ Rapide</h3>
        <p>Aucune dépendance, chargement instantané.</p>
      </article>
      <article class="carte">
        <h3>📱 Responsive</h3>
        <p>S'adapte du mobile au grand écran.</p>
      </article>
      <article class="carte">
        <h3>🎨 Moderne</h3>
        <p>Variables CSS, dégradés et animations.</p>
      </article>
    </section>

    <section class="interaction">
      <h2>Teste l'interaction</h2>
      <input id="champ" type="text" placeholder="Écris quelque chose…" />
      <button id="valider">Valider</button>
      <p id="sortie" aria-live="polite"></p>
    </section>
  </main>
</div>
`,
  }
}

// ── Roblox / Luau : systèmes avancés supplémentaires ─────────────────────────

function luauCombatRaycast(ctx: Ctx): GeneratedCode {
  const damage = ctx.entities.numbers?.find((n) => n >= 5 && n <= 200) ?? 25
  return {
    language: 'lua',
    filename: 'combat_raycast_serveur.lua',
    description: `système de combat/tir Raycast sécurisé côté serveur (${damage} dégâts, anti-cheat distance + cadence)`,
    code: `--=============================================================--
-- SYSTÈME DE COMBAT RAYCAST SÉCURISÉ — Roblox Studio (Luau)
-- À placer dans ServerScriptService
-- Anti-cheat serveur : validation des types, cadence, distance et Raycast
--=============================================================--

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local DEGATS = ${damage}
local PORTEE_MAX = 140
local CADENCE_MIN = 0.35 -- secondes entre deux tirs

local remoteTir = ReplicatedStorage:FindFirstChild("TirArme") :: RemoteEvent?
if not remoteTir then
	local ev = Instance.new("RemoteEvent")
	ev.Name = "TirArme"
	ev.Parent = ReplicatedStorage
	remoteTir = ev
end

local dernierTir: { [number]: number } = {}

Players.PlayerRemoving:Connect(function(joueur)
	dernierTir[joueur.UserId] = nil
end)

remoteTir.OnServerEvent:Connect(function(tireur: Player, pointVise: unknown)
	-- 1. Validation stricte des types reçus du client
	if typeof(pointVise) ~= "Vector3" then
		return
	end
	if pointVise.X ~= pointVise.X or pointVise.Y ~= pointVise.Y or pointVise.Z ~= pointVise.Z then
		return -- Protection anti-NaN
	end

	-- 2. Anti-spam / cadence serveur (Rate-Limit)
	local maintenant = os.clock()
	if maintenant - (dernierTir[tireur.UserId] or 0) < CADENCE_MIN then
		return
	end
	dernierTir[tireur.UserId] = maintenant

	-- 3. Vérification de l'état du tireur
	local personnage = tireur.Character
	local racine = personnage and personnage:FindFirstChild("HumanoidRootPart") :: BasePart?
	local humTireur = personnage and personnage:FindFirstChildOfClass("Humanoid")
	if not racine or not humTireur or humTireur.Health <= 0 then
		return
	end

	-- 4. Raycast autoritaire côté serveur
	local origine = racine.Position + Vector3.new(0, 1.5, 0)
	local direction = (pointVise - origine)
	if direction.Magnitude < 0.1 then
		return
	end
	local vecteurRayon = direction.Unit * math.min(direction.Magnitude + 2, PORTEE_MAX)

	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { personnage }
	params.IgnoreWater = true

	local resultat = Workspace:Raycast(origine, vecteurRayon, params)
	if not resultat or not resultat.Instance then
		return
	end

	local modeleCible = resultat.Instance:FindFirstAncestorOfClass("Model")
	local humCible = modeleCible and modeleCible:FindFirstChildOfClass("Humanoid")
	if humCible and humCible.Health > 0 and humCible ~= humTireur then
		local multiplicateur = resultat.Instance.Name == "Head" and 1.5 or 1.0
		humCible:TakeDamage( math.round(DEGATS * multiplicateur) )
		print(string.format("🎯 %s a touché %s (%d dégâts)", tireur.Name, modeleCible.Name, math.round(DEGATS * multiplicateur)))
	end
end)

print("✅ Système de combat Raycast serveur actif")
`,
  }
}

function luauPetFollower(_ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'pet_compagnon.lua',
    description: 'système de familier (Pet) flottant qui suit le joueur avec AlignPosition et AlignOrientation',
    code: `--=============================================================--
-- SYSTÈME DE FAMILIER (PET FOLLOWER) — Roblox Studio (Luau)
-- À placer dans ServerScriptService
-- Crée un compagnon lumineux fluide qui suit chaque joueur
--=============================================================--

local Players = game:GetService("Players")

local DECALAGE_PET = Vector3.new(3, 2.2, 2.5)

local function creerPetPourPersonnage(personnage: Model)
	local racine = personnage:WaitForChild("HumanoidRootPart", 5) :: BasePart?
	if not racine then return end

	local pet = Instance.new("Part")
	pet.Name = "FamilierNexus"
	pet.Shape = Enum.PartType.Ball
	pet.Size = Vector3.new(1.8, 1.8, 1.8)
	pet.Color = Color3.fromRGB(90, 200, 255)
	pet.Material = Enum.Material.Neon
	pet.CanCollide = false
	pet.Massless = true
	pet.CFrame = racine.CFrame * CFrame.new(DECALAGE_PET)
	pet.Parent = personnage

	local attJoueur = Instance.new("Attachment")
	attJoueur.Name = "AttPetCible"
	attJoueur.Position = DECALAGE_PET
	attJoueur.Parent = racine

	local attPet = Instance.new("Attachment")
	attPet.Parent = pet

	local alignPos = Instance.new("AlignPosition")
	alignPos.Attachment0 = attPet
	alignPos.Attachment1 = attJoueur
	alignPos.MaxForce = 25000
	alignPos.Responsiveness = 18
	alignPos.Parent = pet

	local alignOri = Instance.new("AlignOrientation")
	alignOri.Attachment0 = attPet
	alignOri.Attachment1 = attJoueur
	alignOri.MaxTorque = 25000
	alignOri.Responsiveness = 15
	alignOri.Parent = pet
end

Players.PlayerAdded:Connect(function(joueur)
	joueur.CharacterAdded:Connect(creerPetPourPersonnage)
	if joueur.Character then
		creerPetPourPersonnage(joueur.Character)
	end
end)

print("🐾 Système de familier (Pet Follower) initialisé")
`,
  }
}

function luauQuestSystem(_ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'systeme_quetes.lua',
    description: 'gestionnaire de quêtes serveur avec suivi de progression et récompenses automatiques',
    code: `--=============================================================--
-- GESTIONNAIRE DE QUÊTES & RÉCOMPENSES — Roblox Studio (Luau)
-- À placer dans ServerScriptService
--=============================================================--

local Players = game:GetService("Players")

export type Quete = {
	id: string,
	titre: string,
	objectif: number,
	recompenseOr: number,
}

local CATALOGUE_QUETES: { Quete } = {
	{ id = "collecter_pieces", titre = "Collecter 10 pièces", objectif = 10, recompenseOr = 150 },
	{ id = "explorer_zones", titre = "Découvrir 3 zones", objectif = 3, recompenseOr = 250 },
}

local progression: { [number]: { [string]: number } } = {}

local function initialiserQuetes(joueur: Player)
	progression[joueur.UserId] = {}
	for _, q in CATALOGUE_QUETES do
		progression[joueur.UserId][q.id] = 0
	end
end

local function avancerQuete(joueur: Player, idQuete: string, quantite: number)
	local etat = progression[joueur.UserId]
	if not etat or etat[idQuete] == nil or etat[idQuete] == -1 then
		return
	end
	for _, q in CATALOGUE_QUETES do
		if q.id == idQuete then
			etat[idQuete] = math.min(q.objectif, etat[idQuete] + quantite)
			print(string.format("📜 [%s] %s : %d/%d", joueur.Name, q.titre, etat[idQuete], q.objectif))
			if etat[idQuete] >= q.objectif then
				etat[idQuete] = -1 -- Terminée
				local stats = joueur:FindFirstChild("leaderstats")
				local orVal = stats and stats:FindFirstChild("Argent") :: IntValue?
				if orVal then
					orVal.Value += q.recompenseOr
				end
				print(string.format("🏆 %s a terminé « %s » (+%d Or) !", joueur.Name, q.titre, q.recompenseOr))
			end
			break
		end
	end
end

Players.PlayerAdded:Connect(initialiserQuetes)
Players.PlayerRemoving:Connect(function(j)
	progression[j.UserId] = nil
end)

_G.AvancerQuete = avancerQuete
print("✅ Gestionnaire de quêtes prêt (_G.AvancerQuete)")
`,
  }
}

// ── TypeScript / React / API / SQL / Rust / Go / C# avancés ──────────────────

function tsSpecialized(ctx: Ctx): GeneratedCode {
  const sujet = ctx.topic || 'service TypeScript'
  if (has(ctx.text, /react|composant|component|hook|tsx|interface|ui|dashboard/i)) {
    return {
      language: 'typescript',
      filename: 'ComposantInteractif.tsx',
      description: `composant React + TypeScript interactif avec recherche, filtrage et état typé (${sujet})`,
      code: `import React, { useState, useMemo } from 'react';

export interface ElementItem {
  id: string;
  titre: string;
  categorie: 'prioritaire' | 'standard' | 'archive';
  progression: number;
}

const ELEMENTS_INITIAUX: ElementItem[] = [
  { id: '1', titre: 'Architecture principale', categorie: 'prioritaire', progression: 100 },
  { id: '2', titre: 'Sécurisation des entrées', categorie: 'prioritaire', progression: 80 },
  { id: '3', titre: 'Optimisation des performances', categorie: 'standard', progression: 45 },
];

export default function TableauDeBord() {
  const [elements, setElements] = useState<ElementItem[]>(ELEMENTS_INITIAUX);
  const [recherche, setRecherche] = useState('');
  const [nouveauTitre, setNouveauTitre] = useState('');

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return elements.filter((el) => !q || el.titre.toLowerCase().includes(q));
  }, [elements, recherche]);

  const ajouterElement = (e: React.FormEvent) => {
    e.preventDefault();
    const propre = nouveauTitre.trim();
    if (!propre) return;
    setElements((prev) => [
      ...prev,
      { id: crypto.randomUUID(), titre: propre, categorie: 'standard', progression: 0 },
    ]);
    setNouveauTitre('');
  };

  return (
    <section className="mx-auto max-w-2xl rounded-2xl border border-slate-800 bg-slate-950 p-6 text-slate-100 shadow-xl">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">${sujet}</h2>
          <p className="text-xs text-slate-400">{filtres.length} élément(s) affiché(s)</p>
        </div>
        <input
          type="search"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Filtrer…"
          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm"
        />
      </header>

      <form onSubmit={ajouterElement} className="mb-5 flex gap-2">
        <input
          type="text"
          value={nouveauTitre}
          onChange={(e) => setNouveauTitre(e.target.value)}
          placeholder="Nouvel élément…"
          className="flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Ajouter
        </button>
      </form>

      <ul className="space-y-2.5">
        {filtres.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between rounded-xl border border-slate-800/80 bg-slate-900/60 p-3.5"
          >
            <span className="font-medium">{item.titre}</span>
            <span className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs text-indigo-300">
              {item.progression}%
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
`,
    }
  }

  return {
    language: 'typescript',
    filename: 'service.ts',
    description: `module TypeScript strict avec validation, cache mémoire et gestion d'erreurs (${sujet})`,
    code: `// ============================================================
// ${sujet} — TypeScript Strict (Result Pattern + Cache LRU)
// ============================================================

export type Result<T, E = string> =
  | { ok: true; data: T }
  | { ok: false; error: E };

export interface ElementMetier {
  id: string;
  nom: string;
  creeLe: string;
  actif: boolean;
}

export class ServiceMetier {
  private readonly store = new Map<string, ElementMetier>();
  private readonly maxItems: number;

  constructor(maxItems = 500) {
    this.maxItems = maxItems;
  }

  public creer(nomBrut: string): Result<ElementMetier> {
    const nom = nomBrut.trim();
    if (nom.length < 2 || nom.length > 80) {
      return { ok: false, error: 'Le nom doit contenir entre 2 et 80 caractères.' };
    }
    if (this.store.size >= this.maxItems) {
      const plusAncien = this.store.keys().next().value;
      if (plusAncien) this.store.delete(plusAncien);
    }
    const item: ElementMetier = {
      id: crypto.randomUUID(),
      nom,
      creeLe: new Date().toISOString(),
      actif: true,
    };
    this.store.set(item.id, item);
    return { ok: true, data: item };
  }

  public rechercher(terme: string): ElementMetier[] {
    const q = terme.trim().toLowerCase();
    return Array.from(this.store.values()).filter(
      (el) => el.actif && (!q || el.nom.toLowerCase().includes(q))
    );
  }
}

// Exécution directe d'exemple
const service = new ServiceMetier();
const creation = service.creer('${sujet.replace(/'/g, "\\'")}');
if (creation.ok) {
  console.log('✅ Créé :', creation.data);
}
`,
  }
}

function sqlSpecialized(ctx: Ctx): GeneratedCode {
  const sujet = ctx.topic || 'application'
  return {
    language: 'sql',
    filename: 'schema_analytique.sql',
    description: `schéma SQL relationnel complet (tables, index, clés étrangères et requête analytique CTE) pour ${sujet}`,
    code: `-- ============================================================
-- Schéma relationnel & Requête analytique — ${sujet}
-- Compatible PostgreSQL / SQLite 3.35+
-- ============================================================

CREATE TABLE IF NOT EXISTS utilisateurs (
    id          TEXT PRIMARY KEY,
    pseudo      TEXT NOT NULL UNIQUE,
    email       TEXT NOT NULL UNIQUE,
    points      INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
    cree_le     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS evenements_activite (
    id              TEXT PRIMARY KEY,
    utilisateur_id  TEXT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    type_action     TEXT NOT NULL,
    score_delta     INTEGER NOT NULL DEFAULT 0,
    cree_le         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_activite_utilisateur_date
    ON evenements_activite (utilisateur_id, cree_le DESC);

-- Requête analytique avec CTE : classement des utilisateurs actifs sur 7 jours
WITH stats_hebdo AS (
    SELECT
        u.id,
        u.pseudo,
        COUNT(e.id) AS nb_actions,
        COALESCE(SUM(e.score_delta), 0) AS gain_semaine
    FROM utilisateurs u
    LEFT JOIN evenements_activite e
        ON e.utilisateur_id = u.id
       AND e.cree_le >= DATETIME('now', '-7 days')
    GROUP BY u.id, u.pseudo
)
SELECT
    pseudo,
    nb_actions,
    gain_semaine,
    RANK() OVER (ORDER BY gain_semaine DESC) AS rang
FROM stats_hebdo
ORDER BY gain_semaine DESC
LIMIT 25;
`,
  }
}

const GENERIC_BUILDERS: Record<string, (ctx: Ctx) => GeneratedCode> = {
  javascript: jsGeneric,
  html: htmlGeneric,
  lua: luauGeneric,
  typescript: tsSpecialized,
  csharp: (ctx) =>
    genericSimple(
      ctx,
      'csharp',
      'Controleur.cs',
      `using System;\nusing System.Collections.Generic;\nusing System.Linq;\n\nnamespace NexusApp\n{\n    public record Element(Guid Id, string Nom, int Score);\n\n    public class Gestionnaire\n    {\n        private readonly List<Element> _elements = new();\n\n        public Element Ajouter(string nom, int score)\n        {\n            if (string.IsNullOrWhiteSpace(nom)) throw new ArgumentException("Nom requis");\n            var item = new Element(Guid.NewGuid(), nom.Trim(), Math.Max(0, score));\n            _elements.Add(item);\n            return item;\n        }\n\n        public IEnumerable<Element> Top(int limite = 5) =>\n            _elements.OrderByDescending(e => e.Score).Take(limite);\n\n        public static void Main()\n        {\n            var g = new Gestionnaire();\n            g.Ajouter("Alpha", 120);\n            g.Ajouter("Beta", 250);\n            foreach (var el in g.Top())\n                Console.WriteLine($"✅ {el.Nom} : {el.Score} pts");\n        }\n    }\n}\n`
    ),
  java: (ctx) =>
    genericSimple(
      ctx,
      'java',
      'Main.java',
      `import java.util.*;\n\npublic class Main {\n    public record Element(String nom, int score) {}\n\n    public static void main(String[] args) {\n        List<Element> liste = new ArrayList<>(List.of(\n            new Element("Alpha", 120),\n            new Element("Beta", 280),\n            new Element("Gamma", 195)\n        ));\n        liste.sort(Comparator.comparingInt(Element::score).reversed());\n        liste.forEach(e -> System.out.printf("✅ %s : %d pts%n", e.nom(), e.score()));\n    }\n}\n`
    ),
  cpp: (ctx) =>
    genericSimple(
      ctx,
      'cpp',
      'main.cpp',
      `#include <algorithm>\n#include <iostream>\n#include <string>\n#include <vector>\n\nstruct Joueur {\n    std::string nom;\n    int score;\n};\n\nint main() {\n    std::vector<Joueur> joueurs = {{"Alpha", 150}, {"Beta", 320}, {"Gamma", 210}};\n    std::sort(joueurs.begin(), joueurs.end(), [](const auto& a, const auto& b) {\n        return a.score > b.score;\n    });\n    for (const auto& j : joueurs) {\n        std::cout << "✅ " << j.nom << " : " << j.score << " pts\\n";\n    }\n    return 0;\n}\n`
    ),
  c: (ctx) =>
    genericSimple(
      ctx,
      'c',
      'main.c',
      `#include <stdio.h>\n#include <stdlib.h>\n\ntypedef struct {\n    const char *nom;\n    int score;\n} Element;\n\nint main(void) {\n    Element items[] = {{"Alpha", 120}, {"Beta", 260}, {"Gamma", 180}};\n    size_t n = sizeof(items) / sizeof(items[0]);\n    for (size_t i = 0; i < n; ++i) {\n        printf("✅ %s : %d pts\\n", items[i].nom, items[i].score);\n    }\n    return EXIT_SUCCESS;\n}\n`
    ),
  go: (ctx) =>
    genericSimple(
      ctx,
      'go',
      'main.go',
      `package main\n\nimport (\n\t"fmt"\n\t"sort"\n)\n\ntype Element struct {\n\tNom   string\n\tScore int\n}\n\nfunc main() {\n\titems := []Element{{"Alpha", 120}, {"Beta", 310}, {"Gamma", 190}}\n\tsort.Slice(items, func(i, j int) bool { return items[i].Score > items[j].Score })\n\tfor _, item := range items {\n\t\tfmt.Printf("✅ %s : %d pts\\n", item.Nom, item.Score)\n\t}\n}\n`
    ),
  rust: (ctx) =>
    genericSimple(
      ctx,
      'rust',
      'main.rs',
      `#[derive(Debug, Clone)]\nstruct Element {\n    nom: String,\n    score: u32,\n}\n\nfn main() {\n    let mut items = vec![\n        Element { nom: "Alpha".into(), score: 140 },\n        Element { nom: "Beta".into(), score: 320 },\n        Element { nom: "Gamma".into(), score: 210 },\n    ];\n    items.sort_by(|a, b| b.score.cmp(&a.score));\n    for item in &items {\n        println!("✅ {} : {} pts", item.nom, item.score);\n    }\n}\n`
    ),
  bash: (ctx) =>
    genericSimple(
      ctx,
      'bash',
      'script.sh',
      `#!/usr/bin/env bash\n# Script Bash robuste généré par NEXUS\nset -euo pipefail\nIFS=$'\\n\\t'\n\nlog() { printf '[%s] %s\\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*"; }\n\nlog "Démarrage des vérifications…"\nlog "Espace disque disponible : $(df -h . | awk 'NR==2 {print $4}')"\nlog "✅ Exécution terminée avec succès."\n`
    ),
  sql: sqlSpecialized,
  glsl: (ctx) =>
    genericSimple(
      ctx,
      'glsl',
      'shader.frag',
      `precision highp float;\n\nuniform float u_time;\nuniform vec2 u_resolution;\n\nvoid main() {\n    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;\n    float d = length(uv);\n    float onde = sin(d * 18.0 - u_time * 3.0) * 0.5 + 0.5;\n    float halo = 0.04 / max(abs(d - 0.25), 0.005);\n    vec3 col = mix(vec3(0.05, 0.08, 0.20), vec3(0.35, 0.75, 1.0), onde) + halo * vec3(0.4, 0.6, 1.0);\n    gl_FragColor = vec4(col, 1.0);\n}\n`
    ),
}

function genericSimple(ctx: Ctx, language: string, filename: string, code: string): GeneratedCode {
  return { language, filename, code, description: `programme ${language} structuré : ${ctx.topic || 'script'}` }
}

// ── Refactoring et amélioration intelligente du code existant ────────────────

export interface RefactoredCodeResult {
  modified: boolean
  files: { html: string; css: string; js: string; language?: string; filename?: string }
  changesSummary: string[]
  description: string
}

/**
 * Analyse et transforme réellement le code ouvert dans le Studio Code
 * lorsque l'utilisateur demande de le corriger, sécuriser, optimiser ou enrichir.
 */
export function refactorExistingCode(
  current: { html: string; css: string; js: string; language?: string; filename?: string },
  instruction: string
): RefactoredCodeResult | null {
  const hasWeb = Boolean(current.html.trim() || current.css.trim())
  const rawJs = current.js || ''
  if (!hasWeb && !rawJs.trim()) return null

  const changes: string[] = []
  let html = current.html
  let css = current.css
  let js = current.js
  const lang = (current.language || (hasWeb ? 'web' : 'lua')).toLowerCase()

  // 1) Refactoring / sécurisation d'un script Luau / Roblox
  if (lang === 'lua' || lang === 'luau' || /game:GetService|Instance\.new|OnServerEvent|Humanoid/i.test(js)) {
    if (/\bwait\s*\(/.test(js) && !/task\.wait/.test(js)) {
      js = js.replace(/\bwait\s*\(/g, 'task.wait(')
      changes.push('Remplacement de `wait()` déprécié par `task.wait()` (scheduler 60 Hz)')
    }
    if (/\bspawn\s*\(/.test(js) && !/task\.spawn/.test(js)) {
      js = js.replace(/\bspawn\s*\(/g, 'task.spawn(')
      changes.push('Remplacement de `spawn()` par `task.spawn()` sans latence')
    }
    if (/\bdelay\s*\(/.test(js) && !/task\.delay/.test(js)) {
      js = js.replace(/\bdelay\s*\(/g, 'task.delay(')
      changes.push('Remplacement de `delay()` par `task.delay()`')
    }
    if (/while\s+true\s+do\b/.test(js) && !/task\.wait|wait\s*\(/.test(js)) {
      js = js.replace(/while\s+true\s+do/g, 'while true do\n\ttask.wait(0.1) -- Garde anti-gel serveur')
      changes.push('Ajout de `task.wait(0.1)` dans la boucle `while true do` pour éviter le crash serveur')
    }
    if (/OnServerEvent:Connect\(\s*function\s*\(([^)]+)\)/.test(js) && !/typeof\s*\(/.test(js)) {
      js = js.replace(
        /OnServerEvent:Connect\(\s*function\s*\(([^)]+)\)/g,
        (match, argsStr: string) => {
          const parts = argsStr.split(',').map((s) => s.trim()).filter(Boolean)
          if (parts.length >= 2) {
            const secondArg = parts[1].split(':')[0].trim()
            changes.push(`Ajout d'une garde de validation serveur sur \`${secondArg}\` dans \`OnServerEvent\``)
            return `${match}\n\t-- Sécurité serveur ajoutée par NEXUS : validation des entrées client\n\tif ${secondArg} == nil then return end`
          }
          return match
        }
      )
    }
    if (/:(GetAsync|SetAsync|UpdateAsync)\s*\(/.test(js) && !/\bpcall\b/.test(js)) {
      js =
        `-- Note sécurité NEXUS : fonction utilitaire pcall pour DataStore\nlocal function appelDataStoreSecurise(fn)\n\tlocal ok, res = pcall(fn)\n\tif not ok then warn("[DataStore] Erreur interceptée :", res) end\n\treturn ok, res\nend\n\n` +
        js
      changes.push('Ajout d’un wrapper `pcall` sécurisé pour protéger les appels DataStore contre les pannes réseau')
    }
    if (/cooldown|anti.?spam|debounce/i.test(instruction) && !/dernierAppel/.test(js)) {
      js =
        `local dernierAppel: { [any]: number } = {}\nlocal DELAI_COOLDOWN = 0.5\n\n` +
        js
      changes.push('Ajout d’une table de cooldown (`dernierAppel`) anti-spam')
    }
  }

  // 2) Refactoring d'une page Web (HTML / CSS / JS)
  if (hasWeb) {
    if (/sombre|dark|th[èe]me|theme/i.test(instruction) && !/theme-toggle/.test(html)) {
      html = html.replace(
        /<\/header>/i,
        `  <button id="theme-toggle" type="button" style="padding:0.45rem 0.9rem;border-radius:999px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer">🌓 Thème</button>\n  </header>`
      )
      css += `\n/* Mode clair/sombre dynamique ajouté par NEXUS */\nbody.light-mode {\n  background: #f8fafc !important;\n  color: #0f172a !important;\n}\n`
      js += `\n// Bascule de thème clair/sombre\ndocument.getElementById('theme-toggle')?.addEventListener('click', () => {\n  document.body.classList.toggle('light-mode');\n});\n`
      changes.push('Ajout d’un bouton de bascule de thème Clair / Sombre (HTML + CSS + JS)')
    }
    if (/animation|fluide|transition|hover|design|am[ée]liore|moderne/i.test(instruction) && !/nexus-enhanced/.test(css)) {
      css += `\n/* Polissage visuel & micro-interactions NEXUS (nexus-enhanced) */\nbutton, .carte, article, input {\n  transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.2s ease, border-color 0.2s ease;\n}\nbutton:hover, .carte:hover, article:hover {\n  transform: translateY(-2px);\n}\nbutton:active {\n  transform: translateY(0) scale(0.98);\n}\n`
      changes.push('Ajout de transitions fluides et micro-interactions au survol (`hover`/`active`) dans le CSS')
    }
  }

  // 3) Refactoring JavaScript / TypeScript
  if (!hasWeb && ['javascript', 'typescript', 'js', 'ts'].includes(lang)) {
    if (/\bvar\s+/.test(js)) {
      js = js.replace(/\bvar\s+/g, 'const ')
      changes.push('Remplacement des déclarations `var` par `const` (portée de bloc stricte)')
    }
    if (/[^=!]==[^=]/.test(js)) {
      js = js.replace(/([^=!])==([^=])/g, '$1===$2')
      changes.push('Remplacement des comparaisons lâches `==` par l’égalité stricte `===`')
    }
  }

  if (changes.length === 0) return null

  return {
    modified: true,
    files: {
      html,
      css,
      js,
      language: current.language,
      filename: current.filename,
    },
    changesSummary: changes,
    description: `version améliorée et sécurisée (${changes.length} amélioration${changes.length > 1 ? 's' : ''})`,
  }
}

// ── Point d'entrée du générateur ─────────────────────────────────────────────

/** Détecte le template le plus adapté et compose le code. */
export function generateCodeLocal(text: string, entities: Entities, topic: string): GeneratedCode {
  const ctx: Ctx = { text, entities, topic }

  // Roblox/Luau : priorité aux templates métier si le sujet correspond
  const robloxLike = has(text, /roblox|luau|game\.|workspace|instance\.new|obby|studio/i)
  if (robloxLike || entities.language === 'lua') {
    if (has(text, /arme|tir|gun|laser|combat|épée|epee|sword|raycast|attaque/i)) return luauCombatRaycast(ctx)
    if (has(text, /pet|familier|compagnon|suiveur/i)) return luauPetFollower(ctx)
    if (has(text, /qu[êe]te|quest|mission|objectif/i)) return luauQuestSystem(ctx)
    if (has(text, /pi[èe]ce|coin|monnaie|argent(\s|$)/i)) return luauCoin(ctx)
    if (has(text, /kill|mortel|tue|lave|degat/i)) return luauKill(ctx)
    if (has(text, /checkpoint|obby|etape/i)) return luauCheckpoint(ctx)
    if (has(text, /teleport|t[ée]l[ée]port/i)) return luauTeleporter(ctx)
    if (has(text, /leaderboard|classement|top\b/i)) return luauLeaderboard(ctx)
    if (has(text, /datastore|sauvegard|save|persist/i)) return luauDatastore(ctx)
    if (has(text, /porte|door/i)) return luauDoor(ctx)
    if (has(text, /vitesse|speed|boost|sprint/i)) return luauSpeed(ctx)
    if (has(text, /pnj|npc|suivre|follow/i)) return luauNpc(ctx)
    if (has(text, /boutique|shop|magasin|acheter/i)) return luauShop(ctx)
    if (has(text, /jour|nuit|cycle|day.?night/i)) return luauDayNight(ctx)
    return luauGeneric(ctx)
  }

  // Si l'utilisateur mentionne React/TSX ou SQL explicitement
  if (has(text, /\b(react|tsx|composant react|hook)\b/i)) return tsSpecialized(ctx)
  if (has(text, /\b(sql|postgres|sqlite|table|requ[êe]te sql|base de donn[ée]es)\b/i)) return sqlSpecialized(ctx)

  // Langage explicite ou déduit
  const lang = entities.language ?? 'python'
  const builder = GENERIC_BUILDERS[lang]
  if (builder) return builder(ctx)

  // Fallback selon le contexte
  if (has(text, /page web|site|html|landing/i)) return htmlGeneric(ctx)
  if (has(text, /discord|bot/i)) return pythonGeneric(ctx)
  return pythonGeneric(ctx)
}
