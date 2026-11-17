// Word packs. "general" is split by difficulty; other packs get a tier from word length.
const PACKS = {
  general: {
    label: "General",
    easy: "apple,banana,cat,dog,fish,bird,sun,moon,star,cloud,rain,tree,flower,house,car,bus,boat,ball,kite,hat,shoe,sock,cake,egg,key,door,bed,cup,book,pen,eye,hand,foot,nose,ear,heart,smile,fire,snow,egg,frog,bee,duck,cow,pig,lion,mouse,train,plane,clock,lamp,chair,table,bell,box,ring,crown,leaf,apple,corn,bread,milk,pizza,donut,cookie,candle,gift,flag,map,tent,drum,rainbow,ghost,robot,snail,spoon,fork,bone,web,sock,sea,hill,road,window,phone".split(","),
    medium: "elephant,giraffe,monkey,snake,spider,turtle,rabbit,penguin,octopus,shark,whale,butterfly,castle,bridge,tower,rocket,bicycle,tractor,helicopter,volcano,island,beach,river,lightning,guitar,piano,trumpet,laptop,camera,television,umbrella,glasses,shirt,balloon,dragon,unicorn,pirate,wizard,mermaid,alien,king,doctor,teacher,pencil,scissors,hammer,ladder,bucket,toothbrush,anchor,compass,trophy,medal,football,sandwich,popcorn,noodles,mango,watermelon,cherry,lemon,owl,bat,crab,dinosaur,skateboard,parachute,submarine,windmill,lighthouse,pyramid,igloo,cactus,mushroom,toaster,fridge,backpack,wallet,magnet,battery,lightbulb,snowman,mountain,kangaroo,peacock,camel,zebra,squirrel,dolphin,jellyfish,hamburger,ice cream,tooth,skeleton,vampire,angel,treasure,cannon,sword,shield,bow,arrow,saxophone,violin,microphone,headphones,keyboard,printer,calculator,envelope,stamp,newspaper,calendar,hourglass,telescope,microscope,thermometer,stethoscope".split(","),
    hard: "astronaut,blacksmith,chameleon,constellation,earthquake,electricity,escalator,evolution,fireworks,gravity,hibernation,hurricane,invisible,jet lag,karaoke,labyrinth,meditation,migration,nightmare,orchestra,photosynthesis,quicksand,recycling,reflection,sandcastle,scarecrow,shadow,sleepwalking,solar eclipse,stampede,sunburn,teleport,time machine,traffic jam,tug of war,ventriloquist,wedding,wifi,yawn,zombie,black hole,brainstorm,deja vu,hide and seek,hiccup,daydream,echo,gossip,homesick,inflation,jealousy,peer pressure,procrastinate,rush hour,selfie,sneeze,snore,stage fright,treadmill,trampoline,thunderstorm,tsunami,avalanche,mirage,eclipse,sunrise,waterfall,lighthouse keeper,birthday party,picnic,bungee jumping,scuba diving,rollercoaster,ferris wheel,haunted house".split(","),
  },
  food: { label: "Food", words: "pizza,burger,samosa,dosa,idli,biryani,pani puri,vada pav,jalebi,gulab jamun,ladoo,chai,coffee,sushi,taco,noodles,pasta,popcorn,pancake,waffle,omelette,sandwich,hot dog,fries,ice cream,cupcake,donut,cheese,chocolate,lollipop,mango,banana,pineapple,watermelon,coconut,grapes,strawberry,corn,carrot,onion,potato,tomato,chilli,lemon,egg,bread,butter,honey,soup,salad,kebab,paratha,naan,momos,maggi,pav bhaji,kulfi,lassi,milkshake,cake".split(",") },
  movies: { label: "Movies & TV", words: "superhero,villain,zombie,vampire,robot,dinosaur,pirate ship,space war,time travel,treasure map,haunted house,car chase,heist,detective,magic wand,lightsaber,spaceship,alien invasion,mummy,werewolf,giant ape,shark attack,iceberg,ninja,cowboy,knight,princess,dragon,wizard school,popcorn,red carpet,award,director,camera,clapperboard,cinema,trailer,sequel,stunt,explosion,parachute,jungle,cartoon,puppet,clown,circus,magician,dance number,villain laugh,secret agent".split(",") },
  india: { label: "India", words: "taj mahal,india gate,qutub minar,red fort,lotus temple,gateway of india,charminar,golden temple,kerala boat,himalaya,ganga,desert camel,auto rickshaw,local train,tiffin,dabba,cricket,kabaddi,kite festival,diwali,holi,rangoli,diya,firecracker,mehendi,saree,kurta,turban,bindi,bangles,peacock,tiger,elephant,cow,mango tree,coconut tree,banyan tree,temple bell,chai stall,street food,bollywood,yoga,meditation,monsoon,traffic,flyover,metro,scooter,tractor,village well".split(",") },
  hinglish: { label: "Hinglish", words: "chai,jugaad,dhaba,nautanki,chakkar,mausi,dabba,pakora,thali,chappal,jhola,dupatta,gali cricket,tapri,bhelpuri,kulhad,rickshaw,gol gappa,lassi,paan,mela,jhoola,patang,lattoo,kanche,gilli danda,chulha,matka,lota,charpai,ghungroo,dholak,shehnai,baraat,ghodi,doli,palki,chaiwala,doodhwala,sabziwala,mandir,masjid,gurudwara,bindi,mehendi,anarkali,rangoli,diya,laddoo".split(",") },
};
const TIER_MULT = { easy: 1, medium: 1.25, hard: 1.5 };
function tierOf(w) {
  const g = PACKS.general;
  if (g.easy.includes(w)) return "easy";
  if (g.medium.includes(w)) return "medium";
  if (g.hard.includes(w)) return "hard";
  const n = w.replace(/ /g, "").length;
  return n <= 5 ? "easy" : n <= 8 ? "medium" : "hard";
}
function packWords(pack) {
  const p = PACKS[pack] || PACKS.general;
  return p.words ? p.words : [...new Set([...p.easy, ...p.medium, ...p.hard])];
}
